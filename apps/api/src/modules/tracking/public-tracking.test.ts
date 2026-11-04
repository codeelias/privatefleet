/**
 * Public tracking gate (Stage 4, commit 4): scoped job payload, hashed token,
 * expiry/revocation, rate limiting and no cross-tenant leakage.
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
  AUTH_JWT_SECRET: "tracking-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});
const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const createdTenants: string[] = [];

let tenantId = "";
let token = "";
let jobId = "";
let publicToken = "";
let trackingTokenId = "";

function authed(): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await app.ready();
  const registered = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName: `Tracking ${randomUUID().slice(0, 6)}`,
      email: `tracking-${randomUUID().slice(0, 6)}@example.test`,
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

  const driverId = randomUUID();
  const vehicleId = randomUUID();
  jobId = randomUUID();
  await migrator.sql`
    INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id,
      latitude, longitude, captured_at)
    VALUES (${vehicleId}, ${tenantId}, 'TRK-1', 'Van', 'on_route', ${driverId}, 51.505, -0.12, now())
  `;
  await migrator.sql`
    INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
    VALUES (${driverId}, ${tenantId}, 'Tracking Driver', 'on_route', 'unused', ${vehicleId}, now())
  `;
  await migrator.sql`
    INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status,
      assigned_driver_id, assigned_vehicle_id)
    VALUES (${jobId}, ${tenantId}, 'TRK-JOB', 'Delivery', 'standard', 'in_progress',
      ${driverId}, ${vehicleId})
  `;
  const stopId = randomUUID();
  await migrator.sql`
    INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude,
      longitude, window_start, window_end, status)
    VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'dropoff', '1 Tracking Way', 51.505, -0.12,
      now(), now() + interval '1 hour', 'arrived')
  `;
  const routeId = randomUUID();
  await migrator.sql`
    INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version, geometry)
    VALUES (${routeId}, ${tenantId}, current_date, ${driverId}, ${vehicleId}, 'published', 1,
      '[{"latitude": 51.505, "longitude": -0.120}, {"latitude": 51.506, "longitude": -0.121}]'::jsonb)
  `;
  await migrator.sql`
    INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no, planned_arrival_at, status)
    VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${stopId}, 1, now() + interval '20 minutes', 'planned')
  `;

  const area = await app.inject({
    method: "POST",
    url: "/v1/geofences",
    headers: authed(),
    payload: {
      name: "Delivery area",
      jobId,
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
  expect(area.statusCode).toBe(200);

  await migrator.sql`
    INSERT INTO stop_evidence (id, tenant_id, job_id, stop_id, kind, storage_key, content_hash, mime_type, byte_size, captured_at)
    VALUES (${randomUUID()}, ${tenantId}, ${jobId}, ${stopId}, 'photo', 'evidence/photo.jpg', 'sha256:test', 'image/jpeg', 12, now())
  `;
  await migrator.sql`
    INSERT INTO stop_evidence (id, tenant_id, job_id, stop_id, kind, storage_key, content_hash, mime_type, byte_size, captured_at)
    VALUES (${randomUUID()}, ${tenantId}, ${jobId}, ${stopId}, 'signature', 'evidence/signature.svg', 'sha256:sig', 'image/svg+xml', 8, now())
  `;

  const created = await app.inject({
    method: "POST",
    url: "/v1/tracking-tokens",
    headers: authed(),
    payload: { jobId },
  });
  expect(created.statusCode).toBe(200);
  const body = created.json() as { id: string; token: string; url: string };
  trackingTokenId = body.id;
  publicToken = body.token;
});

afterAll(async () => {
  await app.close();
  for (const id of createdTenants) {
    await migrator.sql`DELETE FROM outbox WHERE tenant_id = ${id}`;
    await migrator.sql`DELETE FROM tenants WHERE id = ${id}`;
  }
  await closeDb(migrator);
});

describe("public customer tracking", () => {
  it("serves the scoped job view through the hashed token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/public/tracking/${publicToken}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
    const body = res.json() as {
      jobReference: string;
      status: string;
      eta?: string;
      driverName?: string;
      vehicleRegistration?: string;
      position?: { latitude: number; longitude: number };
      stops: Array<{ address: string; status: string }>;
      delayStatus?: string;
      etaConfidence?: string;
      remainingStops?: number;
      lastUpdateAt?: string;
      inCustomerZone?: boolean;
      customerZoneName?: string;
      proof?: { photos: number; signatures: number };
      liveProgress?: { stopsAway: number; etaMinutes: number };
    };
    expect(body.jobReference).toBe("TRK-JOB");
    expect(body.status).toBe("in_progress");
    expect(body.eta).toBeDefined();
    expect(body.driverName).toBe("Tracking Driver");
    expect(body.vehicleRegistration).toBe("TRK-1");
    expect(body.position?.latitude).toBeCloseTo(51.505);
    expect(body.stops).toHaveLength(1);
    expect(body.stops[0]?.address).toBe("1 Tracking Way");
    expect(body.delayStatus).toBe("on_time");
    expect(body.liveProgress).toBeDefined();
    expect(body.liveProgress?.stopsAway).toBe(0);
    expect(typeof body.liveProgress?.etaMinutes).toBe("number");
    expect(body.etaConfidence).toBeDefined();
    expect(body.remainingStops).toBe(1);
    expect(body.lastUpdateAt).toBeDefined();
    expect(body.inCustomerZone).toBe(true);
    expect(body.customerZoneName).toBe("Delivery area");
    expect(body.proof?.photos).toBe(1);
    expect(body.proof?.signatures).toBe(1);
    expect(JSON.stringify(body)).not.toContain("phone");
  });

  it("rejects invalid and revoked tokens and rate limits bursts", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/v1/public/tracking/not-a-real-token-0000000000",
    });
    expect(missing.statusCode).toBe(404);

    const revoke = await app.inject({
      method: "DELETE",
      url: `/v1/tracking-tokens/${trackingTokenId}`,
      headers: authed(),
    });
    expect(revoke.statusCode).toBe(200);
    const revoked = await app.inject({
      method: "GET",
      url: `/v1/public/tracking/${publicToken}`,
    });
    expect(revoked.statusCode).toBe(404);

    // Fresh token to exercise the limiter (10 per 10s).
    const fresh = await app.inject({
      method: "POST",
      url: "/v1/tracking-tokens",
      headers: authed(),
      payload: { jobId },
    });
    const freshToken = (fresh.json() as { token: string }).token;
    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/public/tracking/${freshToken}`,
      });
      if (res.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});


