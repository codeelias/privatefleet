/**
 * Trip/stop segmentation gate (Stage 4, commit 2): threshold behaviour,
 * fixed-anchor stop clustering and the 5-minute gap rule.
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
  AUTH_JWT_SECRET: "segment-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});
const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

let tenantId = "";
let token = "";
let vehicleId = "";

function authed(): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await app.ready();
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName: `Segment ${randomUUID().slice(0, 6)}`,
      email: `segment-${randomUUID().slice(0, 6)}@example.test`,
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
  vehicleId = randomUUID();
  await migrator.sql`
    INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status)
    VALUES (${vehicleId}, ${tenantId}, 'SEG-1', 'Van', 'on_route')
  `;

  const base = Date.parse("2026-10-30T08:00:00Z");
  let seq = 1;
  const insertPoint = async (
    offsetMs: number,
    latitude: number,
    longitude: number,
    speedMps: number | null,
  ): Promise<void> => {
    await migrator.sql`
      INSERT INTO location_points (id, tenant_id, vehicle_id, driver_id, captured_at, latitude,
        longitude, speed_mps, sequence_no)
      VALUES (${randomUUID()}, ${tenantId}, ${vehicleId}, NULL,
        ${new Date(base + offsetMs).toISOString()}, ${latitude}, ${longitude}, ${speedMps}, ${seq})
    `;
    seq += 1;
  };

  // Trip: 3 m/s for 150 s, moving ~10 m per 10 s sample.
  for (let i = 0; i <= 15; i += 1) {
    await insertPoint(i * 10_000, 51.5 + i * 0.00009, -0.12 + i * 0.00009, 3);
  }
  // Stop: 12 samples every 20 s, all within 50 m of the anchor -> 220 s stop.
  for (let i = 0; i < 12; i += 1) {
    await insertPoint(600_000 + i * 20_000, 51.501, -0.121 + i * 0.00001, 0);
  }
  // Gap rule: a lone moving point 6 minutes after the stop must not join it.
  await insertPoint(600_000 + 12 * 20_000 + 6 * 60_000, 51.5015, -0.1215, 3);
});

afterAll(async () => {
  await app.close();
  for (const id of createdTenants) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM tenants WHERE id = ${id}`;
  }
  await closeDb(migrator);
});

describe("trip and stop segmentation", () => {
  it("detects the sustained trip and the anchored stop", async () => {
    const trips = await app.inject({
      method: "GET",
      url: `/v1/reports/trips?vehicleId=${vehicleId}&from=2026-10-30T07:00:00Z&to=2026-10-30T09:00:00Z`,
      headers: authed(),
    });
    expect(trips.statusCode).toBe(200);
    const tripBody = trips.json() as {
      segments: Array<{ durationS: number; distanceM: number; points: number }>;
    };
    expect(tripBody.segments.length).toBe(1);
    expect(tripBody.segments[0]?.durationS).toBeGreaterThanOrEqual(120);
    expect(tripBody.segments[0]?.distanceM).toBeGreaterThan(0);
    expect(tripBody.segments[0]?.points).toBe(16);

    const stops = await app.inject({
      method: "GET",
      url: `/v1/reports/stops?vehicleId=${vehicleId}&from=2026-10-30T07:00:00Z&to=2026-10-30T09:00:00Z`,
      headers: authed(),
    });
    expect(stops.statusCode).toBe(200);
    const stopBody = stops.json() as {
      segments: Array<{ durationS: number; maxRadiusM: number; points: number }>;
    };
    expect(stopBody.segments.length).toBe(1);
    expect(stopBody.segments[0]?.durationS).toBeGreaterThanOrEqual(180);
    expect(stopBody.segments[0]?.maxRadiusM).toBeLessThanOrEqual(50);
    expect(stopBody.segments[0]?.points).toBe(12);
  });
});
