/**
 * Geofence evaluation gate (Stage 4, commit 3): PostGIS enter/exit during
 * telemetry ingestion, idempotent transitions, outbox events and alerts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
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
  AUTH_JWT_SECRET: "geofence-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});
const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

let tenantId = "";
let slug = "";
let ownerToken = "";
let driverToken = "";
let driverId = "";
let vehicleId = "";

function authed(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await app.ready();
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName: `Geofence ${randomUUID().slice(0, 6)}`,
      email: `geofence-${randomUUID().slice(0, 6)}@example.test`,
      password: "correct horse battery staple",
    },
  });
  expect(registered.statusCode).toBe(200);
  const session = registered.json() as {
    tenant: { id: string; slug: string };
    tokens: { accessToken: string };
  };
  tenantId = session.tenant.id;
  slug = session.tenant.slug;
  ownerToken = session.tokens.accessToken;
  createdTenants.push(tenantId);

  driverId = randomUUID();
  vehicleId = randomUUID();
  await migrator.sql`
    INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
    VALUES (${vehicleId}, ${tenantId}, 'GEO-1', 'Van', 'available', ${driverId})
  `;
  const pinHash = await argonHash("1234");
  await migrator.sql`
    INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
    VALUES (${driverId}, ${tenantId}, 'Geofence Driver', 'available', ${pinHash}, ${vehicleId}, now())
  `;
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/driver-login",
    payload: { tenantSlug: slug, driverId, pin: "1234" },
  });
  expect(login.statusCode).toBe(200);
  driverToken = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  const created = await app.inject({
    method: "POST",
    url: "/v1/geofences",
    headers: authed(ownerToken),
    payload: {
      name: "Depot",
      geojson: JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [-0.14, 51.49],
            [-0.1, 51.49],
            [-0.1, 51.52],
            [-0.14, 51.52],
            [-0.14, 51.49],
          ],
        ],
      }),
    },
  });
  expect(created.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  for (const id of createdTenants) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM tenants WHERE id = ${id}`;
  }
  await closeDb(migrator);
});

async function postTelemetry(latitude: number, longitude: number, capturedAt: string) {
  return app.inject({
    method: "POST",
    url: "/v1/telemetry",
    headers: authed(driverToken),
    payload: {
      samples: [{ latitude, longitude, capturedAt, speedMps: 0 }],
    },
  });
}

async function eventCount(type: string): Promise<number> {
  const rows = (await migrator.sql`
    SELECT count(*)::int AS count FROM outbox
    WHERE tenant_id = ${tenantId} AND event_type = ${type}
  `) as unknown as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

describe("geofence evaluation on telemetry ingest", () => {
  it("emits idempotent enter/exit events and dispatcher alerts", async () => {
    // Initialise outside; no previous state, so no event yet.
    const outside1 = await postTelemetry(51.6, -0.15, new Date(Date.now() - 50_000).toISOString());
    expect(outside1.statusCode).toBe(200);
    expect(await eventCount("geofence.entered")).toBe(0);

    // Enter the polygon -> one entered event and an alert.
    const enter = await postTelemetry(51.5, -0.12, new Date().toISOString());
    expect(enter.statusCode).toBe(200);
    expect(await eventCount("geofence.entered")).toBe(1);

    // Replay while still inside -> no duplicate.
    await postTelemetry(51.505, -0.12, new Date(Date.now() + 2_000).toISOString());
    expect(await eventCount("geofence.entered")).toBe(1);

    // Exit -> one exited event and an at-risk alert.
    await postTelemetry(51.6, -0.15, new Date(Date.now() + 4_000).toISOString());
    expect(await eventCount("geofence.exited")).toBe(1);

    const alerts = (await migrator.sql`
      SELECT severity, title, status FROM alerts
      WHERE tenant_id = ${tenantId} ORDER BY created_at
    `) as unknown as Array<{ severity: string; title: string; status: string }>;
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.title).toContain("Entered geofence Depot");
    expect(alerts[0]?.severity).toBe("info");
    expect(alerts[1]?.title).toContain("Exited geofence Depot");
    expect(alerts[1]?.severity).toBe("at_risk");

    const states = (await migrator.sql`
      SELECT inside FROM geofence_states WHERE vehicle_id = ${vehicleId}
    `) as unknown as Array<{ inside: boolean }>;
    expect(states[0]?.inside).toBe(false);
  });
});


describe("geofence lifecycle administration", () => {
  it("lists, disables and deletes tenant geofences through staff endpoints", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/geofences", headers: authed(ownerToken) });
    expect(list.statusCode).toBe(200);
    const zones = (list.json() as { geofences: Array<{ id: string; name: string; enabled: boolean }> }).geofences;
    expect(zones.length).toBeGreaterThanOrEqual(1);

    const depot = zones.find((zone) => zone.name === "Depot");
    expect(depot).toBeDefined();

    const disabled = await app.inject({
      method: "PATCH",
      url: "/v1/geofences/" + depot!.id,
      headers: authed(ownerToken),
      payload: { enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect((disabled.json() as { enabled: boolean }).enabled).toBe(false);

    const driverPatch = await app.inject({
      method: "PATCH",
      url: "/v1/geofences/" + depot!.id,
      headers: authed(driverToken),
      payload: { enabled: true },
    });
    expect(driverPatch.statusCode).toBe(403);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/geofences/" + depot!.id,
      headers: authed(ownerToken),
    });
    expect(deleted.statusCode).toBe(200);
    expect((deleted.json() as { deleted: boolean }).deleted).toBe(true);

    const after = await app.inject({ method: "GET", url: "/v1/geofences", headers: authed(ownerToken) });
    const remaining = (after.json() as { geofences: Array<{ id: string }> }).geofences;
    expect(remaining.some((zone) => zone.id === depot!.id)).toBe(false);
  });

  it("scopes evaluation to selected drivers only", async () => {
    const otherDriverId = randomUUID();
    const otherVehicleId = randomUUID();
    const pinHash = await argonHash("1234");
    await migrator.sql`
      INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${otherVehicleId}, ${tenantId}, 'GEO-2', 'Van', 'available', ${otherDriverId})
    `;
    await migrator.sql`
      INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
      VALUES (${otherDriverId}, ${tenantId}, 'Scoped Driver', 'available', ${pinHash}, ${otherVehicleId}, now())
    `;

    const created = await app.inject({
      method: "POST",
      url: "/v1/geofences",
      headers: authed(ownerToken),
      payload: {
        name: "Scoped zone",
        driverIds: [driverId],
        geojson: JSON.stringify({
          type: "Polygon",
          coordinates: [[[-0.14, 51.49], [-0.1, 51.49], [-0.1, 51.52], [-0.14, 51.52], [-0.14, 51.49]]],
        }),
      },
    });
    expect(created.statusCode).toBe(200);
    const zone = created.json() as { id: string; driverIds: string[] };
    expect(zone.driverIds).toEqual([driverId]);

    // Earlier tests posted future-dated samples; stay ahead of the vehicle's
    // last accepted fix within the 5-minute future tolerance.
    const now = Date.now() + 60_000;
    // First sample initialises the state (no event); the second crosses in.
    await postTelemetry(51.6, -0.15, new Date(now).toISOString());
    await postTelemetry(51.5, -0.12, new Date(now + 10_000).toISOString());
    const scopedEvents = (await migrator.sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE tenant_id = ${tenantId}
        AND event_type = 'geofence.entered'
        AND payload->'payload'->>'geofenceName' = 'Scoped zone'
    `) as unknown as Array<{ count: number }>;
    expect(scopedEvents[0]?.count).toBe(1);

    const rescope = await app.inject({
      method: "PATCH",
      url: "/v1/geofences/" + zone.id,
      headers: authed(ownerToken),
      payload: { driverIds: [otherDriverId] },
    });
    expect(rescope.statusCode).toBe(200);

    await postTelemetry(51.6, -0.15, new Date(now + 20_000).toISOString());
    await postTelemetry(51.5, -0.12, new Date(now + 30_000).toISOString());
    const afterRescope = (await migrator.sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE tenant_id = ${tenantId}
        AND payload->'payload'->>'geofenceName' = 'Scoped zone'
    `) as unknown as Array<{ count: number }>;
    expect(afterRescope[0]?.count).toBe(1);

    await migrator.sql`DELETE FROM geofences WHERE id = ${zone.id}`;
  });
});
