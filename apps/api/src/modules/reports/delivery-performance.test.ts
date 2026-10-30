/**
 * Delivery performance report gate (Stage 4, commit 1): planned vs recorded
 * arrival, on-time classification, explicit unavailable states and CSV export.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "report-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});
const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

let tenantId = "";
let token = "";
let jobId = "";
const stopIds: string[] = [];
const routeId = randomUUID();
const routeDate = new Date().toISOString().slice(0, 10);

function authed(): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await app.ready();
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName: `Report ${randomUUID().slice(0, 6)}`,
      email: `report-${randomUUID().slice(0, 6)}@example.test`,
      password: "correct horse battery staple",
    },
  });
  expect(registered.statusCode).toBe(200);
  const session = registered.json() as {
    tenant: { id: string };
    tokens: { accessToken: string };
  };
  tenantId = session.tenant.id;
  token = session.tokens.accessToken;
  createdTenants.push(tenantId);
  jobId = randomUUID();

  await migrator.sql`
    INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status)
    VALUES (${jobId}, ${tenantId}, 'RPT-1', 'Delivery', 'standard', 'completed')
  `;
  await migrator.sql`
    INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version,
      planned_distance_m, planned_duration_s)
    VALUES (${routeId}, ${tenantId}, ${routeDate}, ${randomUUID()}, ${randomUUID()},
      'published', 2, 5000, 1200)
  `;
  const mk = async (
    address: string,
    status: string,
    windowStart: string,
    windowEnd: string,
    arrivedAt: string | null,
    completedAt: string | null,
    failureCode: string | null,
    plannedArrivalAt: string | null,
    sequence: number,
  ): Promise<string> => {
    const id = randomUUID();
    stopIds.push(id);
    await migrator.sql`
      INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude,
        longitude, window_start, window_end, status, arrived_at, completed_at, failure_code)
      VALUES (${id}, ${tenantId}, ${jobId}, ${sequence}, 'dropoff', ${address}, 51.5, -0.1,
        ${windowStart}, ${windowEnd}, ${status}, ${arrivedAt}, ${completedAt}, ${failureCode})
    `;
    await migrator.sql`
      INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no, planned_arrival_at, status)
      VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${id}, ${sequence}, ${plannedArrivalAt}, 'planned')
    `;
    return id;
  };
  await mk("On Time Street", "completed", "2026-10-30T09:00:00Z", "2026-10-30T10:00:00Z",
    "2026-10-30T09:20:00Z", "2026-10-30T09:30:00Z", null, "2026-10-30T09:15:00Z", 1);
  await mk("Early Street", "completed", "2026-10-30T09:00:00Z", "2026-10-30T10:00:00Z",
    "2026-10-30T08:45:00Z", "2026-10-30T08:50:00Z", null, "2026-10-30T09:00:00Z", 2);
  await mk("Pending Street", "pending", "2026-10-30T09:00:00Z", "2026-10-30T10:00:00Z",
    null, null, null, "2026-10-30T09:30:00Z", 3);
  await mk("Refused Street", "skipped", "2026-10-30T09:00:00Z", "2026-10-30T10:00:00Z",
    "2026-10-30T09:40:00Z", null, "DELIVERY_REFUSED", "2026-10-30T09:30:00Z", 4);
});

afterAll(async () => {
  await app.close();
  for (const id of createdTenants) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM idempotency_keys WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM tenants WHERE id = ${id}`;
  }
  await closeDb(migrator);
});

describe("delivery performance report", () => {
  it("classifies on-time, early, unavailable and failure rows and exports CSV", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/delivery-performance",
      headers: authed(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      generatedAt: string;
      rows: Array<{
        address: string;
        onTime: string;
        arrivalDeltaS?: number;
        windowKnown: boolean;
        arrivalKnown: boolean;
        failureCode?: string;
        plannedDistanceM?: number;
      }>;
    };
    const byAddress = new Map(body.rows.map((row) => [row.address, row]));
    expect(byAddress.get("On Time Street")?.onTime).toBe("on_time");
    expect(byAddress.get("On Time Street")?.arrivalDeltaS).toBe(300);
    expect(byAddress.get("Early Street")?.onTime).toBe("early");
    expect(byAddress.get("Pending Street")?.onTime).toBe("unavailable");
    expect(byAddress.get("Pending Street")?.arrivalKnown).toBe(false);
    expect(byAddress.get("Pending Street")?.windowKnown).toBe(true);
    expect(byAddress.get("Refused Street")?.failureCode).toBe("DELIVERY_REFUSED");
    expect(byAddress.get("On Time Street")?.plannedDistanceM).toBe(5000);

    const csv = await app.inject({
      method: "GET",
      url: "/v1/reports/delivery-performance?format=csv",
      headers: authed(),
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const text = csv.body;
    expect(text).toContain("job_reference");
    expect(text).toContain("RPT-1");
    expect(text).toContain("Unavailable");
    expect(text).toContain("DELIVERY_REFUSED");
  });

  it("filters by job", async () => {
    const otherJob = randomUUID();
    await migrator.sql`
      INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status)
      VALUES (${otherJob}, ${tenantId}, 'RPT-OTHER', 'Delivery', 'standard', 'completed')
    `;
    const res = await app.inject({
      method: "GET",
      url: `/v1/reports/delivery-performance?jobId=${jobId}`,
      headers: authed(),
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { rows: Array<{ jobReference: string }> }).rows;
    expect(rows.length).toBe(4);
    expect(rows.every((row) => row.jobReference === "RPT-1")).toBe(true);
  });
});

