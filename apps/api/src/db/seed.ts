/**
 * Seeds a tenant with the Phase 1 demo dataset so the Phase 2 backend
 * has realistic data for development and integration tests. Runs as the
 * migrator role (RLS bypassed) - never as the runtime app role.
 */
import { randomUUID } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import type { AuthSession } from "@privatefleet/contracts";
import { closeDb, createDb, type DbHandle } from "./client.js";
import { ensureDatabase } from "./ensure-db.js";
import { buildJobDto, DRIVER_SEEDS, JOB_SEEDS } from "../modules/demo/data.js";
import { SCENARIO_ASSIGNMENTS } from "../modules/demo/assignments.js";

export interface SeedOptions {
  tenantName: string;
  email: string;
  password: string;
  /** Deterministic slug for repeatable environments (E2E, staging). */
  slug?: string;
}

export interface SeedResult {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  email: string;
  password: string;
  drivers: number;
  vehicles: number;
  jobs: number;
  driverPin: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export async function seedTenant(
  handle: DbHandle,
  options: SeedOptions,
): Promise<SeedResult> {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const slug = options.slug ?? `${slugify(options.tenantName)}-${randomUUID().slice(0, 6)}`;
  const passwordHash = await argonHash(options.password);
  // Demo driver PINs (Phase 3 device login). Real drivers get a dispatcher-set PIN.
  const driverPinHash = await argonHash("1234");

  const sql = handle.sql;
  if (options.slug) {
    const existing = (await sql`SELECT id FROM tenants WHERE slug = ${options.slug}`) as unknown as Array<{
      id: string;
    }>;
    for (const tenant of existing) {
      await sql`DELETE FROM outbox WHERE tenant_id = ${tenant.id}`;
      await sql`DELETE FROM idempotency_keys WHERE tenant_id = ${tenant.id}`;
      await sql`DELETE FROM refresh_tokens WHERE tenant_id = ${tenant.id}`;
      await sql`DELETE FROM demo_scenarios WHERE tenant_id = ${tenant.id}`;
      await sql`DELETE FROM tenants WHERE id = ${tenant.id}`;
    }
  }
  await sql`
    INSERT INTO tenants (id, name, slug, theme)
    VALUES (${tenantId}, ${options.tenantName}, ${slug},
      ${JSON.stringify({ primary: "#4F8CFF", accent: "#22C55E" })}::jsonb)
  `;
  await sql`
    INSERT INTO proof_policies (tenant_id, service_type, require_recipient, require_signature, require_photo, require_failure_photo)
    VALUES (${tenantId}, '*', true, false, false, false)
    ON CONFLICT (tenant_id, service_type) DO NOTHING
  `;
  await sql`
    INSERT INTO users (id, tenant_id, email, password_hash, role)
    VALUES (${userId}, ${tenantId}, ${options.email.toLowerCase()}, ${passwordHash}, 'owner')
  `;

  let vehicles = 0;
  let drivers = 0;
  const seededDrivers: Array<{ driverId: string; vehicleId: string }> = [];
  for (const [index, seed] of DRIVER_SEEDS.entries()) {
    const vehicleId = randomUUID();
    const driverId = randomUUID();
    await sql`
      INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${tenantId}, ${seed.vehicleRegistration}, ${seed.vehicleType},
        ${index === 1 ? "on_route" : "available"}, ${driverId})
    `;
    await sql`
      INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
      VALUES (${driverId}, ${tenantId}, ${seed.fullName},
        ${index === 1 ? "on_route" : "available"}, ${driverPinHash}, ${vehicleId}, now())
    `;
    seededDrivers.push({ driverId, vehicleId });
    vehicles += 1;
    drivers += 1;
  }

  let jobs = 0;
  for (const [index, seed] of JOB_SEEDS.entries()) {
    const dto = buildJobDto(seed, index);
    const jobId = randomUUID();
    // Apply the Morning Rush assignments so a seeded driver has real work
    // (shared assignment truth with the demo store and route fixtures).
    const assignment = SCENARIO_ASSIGNMENTS["morning-rush"].find(
      (candidate) => candidate.ref === dto.reference,
    );
    const assignedTo = assignment ? seededDrivers[assignment.driver] : undefined;
    await sql`
      INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status,
        assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${tenantId}, ${dto.reference}, ${dto.serviceType}, ${dto.priority},
        ${assignedTo ? "assigned" : "unassigned"},
        ${assignedTo?.driverId ?? null}, ${assignedTo?.vehicleId ?? null})
    `;
    for (const stop of dto.stops) {
      await sql`
        INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address,
          latitude, longitude, window_start, window_end, status)
        VALUES (${randomUUID()}, ${tenantId}, ${jobId}, ${stop.sequenceNo}, ${stop.stopType},
          ${stop.address}, ${stop.location.latitude}, ${stop.location.longitude},
          ${stop.windowStart ?? null}, ${stop.windowEnd ?? null}, 'pending')
      `;
    }
    jobs += 1;
  }

  // Deterministic single-stop jobs for device acceptance: one per driver,
  // so the RN-web and Expo workflows cannot consume each other's fixture.
  const singleStopFixtures = [
    { reference: "J-000", driverIndex: 0, address: "E2E Test Stop, London" },
    { reference: "J-001", driverIndex: 1, address: "Expo Test Stop, London" },
  ];
  for (const fixture of singleStopFixtures) {
    const assigned = seededDrivers[fixture.driverIndex];
    if (!assigned) {
      continue;
    }
    const fixtureJobId = randomUUID();
    await sql`
      INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status,
        assigned_driver_id, assigned_vehicle_id)
      VALUES (${fixtureJobId}, ${tenantId}, ${fixture.reference}, 'Pickup', 'standard', 'assigned',
        ${assigned.driverId}, ${assigned.vehicleId})
    `;
    await sql`
      INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address,
        latitude, longitude, window_start, window_end, status)
      VALUES (${randomUUID()}, ${tenantId}, ${fixtureJobId}, 1, 'pickup',
        ${fixture.address}, 51.5, -0.1, now(), now() + interval '1 hour', 'pending')
    `;
  }
  await sql`
    INSERT INTO alerts (id, tenant_id, severity, status, title, entity, location,
      freshness, recommended_action, reference)
    VALUES (${randomUUID()}, ${tenantId}, 'info', 'open',
      'Fleet ready for dispatch', 'Control room', 'London',
      'just now', 'Assign the first jobs when drivers check in', null)
  `;

  return {
    tenantId,
    tenantSlug: slug,
    userId,
    email: options.email.toLowerCase(),
    password: options.password,
    drivers,
    vehicles,
    jobs,
    driverPin: "1234",
  };
}

/** CLI: `pnpm --filter @privatefleet/api db:seed` */
async function main(): Promise<void> {
  const url =
    process.env.MIGRATION_DATABASE_URL ??
    "postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev";
  await ensureDatabase(url);
  const handle = createDb(url, { max: 1 });
  try {
    const result = await seedTenant(handle, {
      tenantName: "Northstar Couriers",
      email: "owner@northstar.demo",
      password: "demo-password-123",
    });
    console.log("seeded tenant:", JSON.stringify(result, null, 2));
    const session: Pick<AuthSession, "tenant" | "user"> = {
      tenant: { id: result.tenantId, slug: result.tenantSlug, name: "Northstar Couriers" },
      user: { id: result.userId, email: result.email, role: "owner" },
    };
    console.log("login with:", JSON.stringify(session));
  } finally {
    await closeDb(handle);
  }
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}







