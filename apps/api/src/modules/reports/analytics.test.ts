import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { summariseAnalytics } from "./analytics.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "analytics-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});

const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (createdTenants.length > 0) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ANY(${createdTenants}::uuid[])`;
    await migrator.sql`DELETE FROM tenants WHERE id = ANY(${createdTenants}::uuid[])`;
  }
  await closeDb(migrator);
});

describe("analytics summarisation (pure)", () => {
  const base = {
    status: "completed",
    arrived_at: "2026-11-07T10:30:00Z",
    window_start: "2026-11-07T10:00:00Z",
    window_end: "2026-11-07T11:00:00Z",
    planned_arrival_at: "2026-11-07T10:20:00Z",
    driver_id: "d1",
    driver_name: "Ann",
  };

  it("counts on-time and averages the plan delta", () => {
    const result = summariseAnalytics([base, { ...base, arrived_at: "2026-11-07T11:30:00Z" }], 12.34);
    expect(result.totals.stopsCompleted).toBe(2);
    expect(result.totals.onTimePct).toBe(50);
    expect(result.totals.avgArrivalDeltaS).toBe(Math.round((600 + 4200) / 2)); // +10m and +70m
    expect(result.totals.totalDistanceKm).toBe(12.3);
    expect(result.byDriver[0]?.stopsCompleted).toBe(2);
  });

  it("is null when nothing is measurable", () => {
    const result = summariseAnalytics([{ ...base, arrived_at: null, window_start: null, window_end: null }], 0);
    expect(result.totals.onTimePct).toBeNull();
    expect(result.totals.avgArrivalDeltaS).toBeNull();
  });
});

describe("analytics endpoint", () => {
  it("serves honest aggregates for the tenant", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Analytics Co",
        email: `analytics-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const session = register.json() as {
      tenant: { id: string };
      tokens: { accessToken: string };
    };
    const tenantId = session.tenant.id;
    createdTenants.push(tenantId);
    const ownerToken = session.tokens.accessToken;
    const sql = migrator.sql;

    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    const stopId = randomUUID();
    const routeId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${tenantId}, 'ANL-1', 'Van', 'on_route', ${driverId})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id)
      VALUES (${driverId}, ${tenantId}, 'Analytics Driver', 'on_route', 'unused', ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${tenantId}, 'ANL-1', 'Pickup', 'standard', 'completed', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status, arrived_at, completed_at)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', '1 Analytic Way', 51.5, -0.1,
        now() - interval '1 hour', now() + interval '1 hour', 'completed', now(), now())`;
    await sql`INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version, geometry, planned_distance_m, planned_duration_s)
      VALUES (${routeId}, ${tenantId}, current_date, ${driverId}, ${vehicleId}, 'completed', 2,
        '[{"latitude": 51.5, "longitude": -0.1}, {"latitude": 51.51, "longitude": -0.11}]'::jsonb, 2500, 600)`;
    await sql`INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no, planned_arrival_at)
      VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${stopId}, 1, now() - interval '30 minutes')`;
    // An older superseded version of the same plan must NOT double-count.
    await sql`INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version, geometry, planned_distance_m, planned_duration_s)
      VALUES (${randomUUID()}, ${tenantId}, current_date, ${driverId}, ${vehicleId}, 'superseded', 1,
        '[{"latitude": 51.5, "longitude": -0.1}, {"latitude": 51.51, "longitude": -0.11}]'::jsonb, 2500, 600)`;

    const res = await app.inject({
      method: "GET",
      url: "/v1/reports/analytics",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      totals: { stopsCompleted: number; onTimePct: number | null; totalDistanceKm: number };
      byDriver: Array<{ driverId: string; stopsCompleted: number }>;
    };
    expect(body.totals.stopsCompleted).toBe(1);
    expect(body.totals.onTimePct).toBe(100);
    expect(body.totals.totalDistanceKm).toBe(2.5);
    expect(body.byDriver.some((entry) => entry.driverId === driverId && entry.stopsCompleted === 1)).toBe(true);
  });
});
