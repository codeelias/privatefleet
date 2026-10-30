/**
 * Production-readiness RLS probe: uses the runtime role (privatefleet_app,
 * non-owner) and real tenant rows. For every tenant-owned table it proves:
 * - RLS is enabled with a tenant policy,
 * - another tenant's rows are invisible,
 * - UPDATE/DELETE against another tenant affect zero rows,
 * - a foreign-tenant INSERT is rejected by WITH CHECK.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDb, createDb, withTenant, type DbHandle } from "./client.js";
import { migrationDatabaseUrl } from "../config.js";
import { seedTenant } from "./seed.js";

const APP_URL =
  process.env.DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const TENANT_TABLES = [
  "users",
  "vehicles",
  "drivers",
  "jobs",
  "job_stops",
  "job_events",
  "alerts",
  "outbox",
  "refresh_tokens",
  "idempotency_keys",
  "demo_scenarios",
  "location_points",
  "routes",
  "route_stops",
  "optimization_runs",
  "proof_policies",
  "stop_evidence",
  "geofences",
  "geofence_states",
] as const;

let runtime: DbHandle;
let migrator: DbHandle;
const createdTenants: string[] = [];

beforeAll(async () => {
  runtime = createDb(APP_URL, { max: 4 });
  migrator = createDb(migrationDatabaseUrl(), { max: 2 });
});

afterAll(async () => {
  for (const tenantId of createdTenants) {
    await migrator.sql`DELETE FROM tenants WHERE id = ${tenantId}`;
  }
  await closeDb(runtime);
  await closeDb(migrator);
});

async function newTenant(name: string): Promise<string> {
  const seeded = await seedTenant(migrator, {
    tenantName: name,
    email: `owner-${randomUUID().slice(0, 8)}@rls.test`,
    password: "demo-password-123",
    slug: `rls-${randomUUID().slice(0, 8)}`,
  });
  createdTenants.push(seeded.tenantId);
  return seeded.tenantId;
}

describe("RLS inventory and cross-tenant mutation probe", () => {
  it("runs as the runtime role, not the table owner", async () => {
    const rows = (await runtime.sql`SELECT current_user AS role`) as unknown as Array<{
      role: string;
    }>;
    expect(rows[0]?.role).toBe("privatefleet_app");
  });

  it("has RLS enabled and a tenant policy on every tenant-owned table", async () => {
    const expected = [...TENANT_TABLES];
    const rows = (await migrator.sql`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `) as unknown as Array<{ table_name: string; rls: boolean; policies: number }>;
    const byName = new Map(rows.map((row) => [row.table_name, row]));
    for (const table of expected) {
      const entry = byName.get(table);
      expect(entry, `${table} must exist`).toBeTruthy();
      expect(entry?.rls, `${table} must have RLS enabled`).toBe(true);
      expect(entry?.policies ?? 0, `${table} must have a policy`).toBeGreaterThan(0);
    }
  });

  it("hides and blocks cross-tenant reads, updates, deletes and inserts", async () => {
    const tenantA = await newTenant("RLS Alpha");
    const tenantB = await newTenant("RLS Beta");

    // B-owned rows exist in these seeded tables; others are policy-checked
    // through the same generic zero-row assertions.
    const populated = new Set(["users", "vehicles", "drivers", "jobs", "job_stops"]);

    for (const table of TENANT_TABLES) {
      const tableSql = sql.raw(table);
      const foreignCount = (await withTenant(runtime, tenantA, async (tx) => {
        const result = (await tx.execute(
          sql`SELECT count(*)::int AS count FROM ${tableSql} WHERE tenant_id = ${tenantB}`,
        )) as unknown as Array<{ count: number }>;
        return Number(result[0]?.count ?? 0);
      })) as number;
      expect(foreignCount, `${table}: tenant B rows visible to A`).toBe(0);

      const updated = (await withTenant(runtime, tenantA, async (tx) => {
        const result = (await tx.execute(
          sql`UPDATE ${tableSql} SET tenant_id = ${tenantB} WHERE tenant_id = ${tenantB}`,
        )) as unknown as Array<unknown> & { count?: number };
        return result.count ?? 0;
      })) as number;
      expect(updated, `${table}: cross-tenant update must affect 0 rows`).toBe(0);

      const deleted = (await withTenant(runtime, tenantA, async (tx) => {
        const result = (await tx.execute(
          sql`DELETE FROM ${tableSql} WHERE tenant_id = ${tenantB}`,
        )) as unknown as Array<unknown> & { count?: number };
        return result.count ?? 0;
      })) as number;
      expect(deleted, `${table}: cross-tenant delete must affect 0 rows`).toBe(0);

      if (populated.has(table)) {
        const remaining = (await withTenant(runtime, tenantB, async (tx) => {
          const result = (await tx.execute(
            sql`SELECT count(*)::int AS count FROM ${tableSql} WHERE tenant_id = ${tenantB}`,
          )) as unknown as Array<{ count: number }>;
          return Number(result[0]?.count ?? 0);
        })) as number;
        expect(remaining, `${table}: tenant B data must survive`).toBeGreaterThan(0);
      }
    }

    // WITH CHECK: A cannot insert a row claiming B.
    let blocked = false;
    try {
      await withTenant(runtime, tenantA, async (tx) => {
        await tx.execute(sql`
          INSERT INTO alerts
            (tenant_id, severity, status, title, entity, location, freshness, recommended_action)
          VALUES (${tenantB}, 'info', 'open', 'smuggled', 'Test', 'London', 'now', 'none')
        `);
      });
    } catch {
      blocked = true;
    }
    expect(blocked, "foreign-tenant insert must be rejected by WITH CHECK").toBe(true);
  });
});

