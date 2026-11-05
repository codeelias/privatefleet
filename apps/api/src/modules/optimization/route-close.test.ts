/**
 * Route-close guard (docs/53 C2): closing a route must not reset stops whose
 * job is already completed/cancelled, and must clear arrival state on the
 * stops it does reset.
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
  AUTH_JWT_SECRET: "test-secret-at-least-16-characters-long",
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
    await migrator.sql`DELETE FROM idempotency_keys WHERE tenant_id = ANY(${createdTenants}::uuid[])`;
    await migrator.sql`DELETE FROM refresh_tokens WHERE tenant_id = ANY(${createdTenants}::uuid[])`;
    await migrator.sql`DELETE FROM tenants WHERE id = ANY(${createdTenants}::uuid[])`;
  }
  await closeDb(migrator);
});

describe("route close guard", () => {
  it("preserves stops of completed jobs and clears arrival state on reset stops", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Close Guard Co",
        email: `owner-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    expect(register.statusCode).toBe(200);
    const session = register.json() as {
      tenant: { id: string };
      tokens: { accessToken: string };
    };
    const tenantId = session.tenant.id;
    createdTenants.push(tenantId);
    const ownerToken = session.tokens.accessToken;
    const sql = migrator.sql;
    const pinHash = await argonHash("1234");
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const doneJob = randomUUID();
    const doneStop = randomUUID();
    const openJob = randomUUID();
    const openStop = randomUUID();
    const routeId = randomUUID();

    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${tenantId}, 'CAR-88', 'Van', 'on_route', ${driverId})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id)
      VALUES (${driverId}, ${tenantId}, 'Close Driver', 'on_route', ${pinHash}, ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${doneJob}, ${tenantId}, 'CLS-1', 'Pickup', 'standard', 'completed', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${openJob}, ${tenantId}, 'CLS-2', 'Pickup', 'standard', 'assigned', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status, arrived_at)
      VALUES (${doneStop}, ${tenantId}, ${doneJob}, 1, 'pickup', 'Done', 51.5, -0.1, now(), now() + interval '2 hours', 'arrived', now() - interval '1 hour')`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status, arrived_at)
      VALUES (${openStop}, ${tenantId}, ${openJob}, 1, 'pickup', 'Open', 51.51, -0.11, now(), now() + interval '2 hours', 'arrived', now() - interval '1 hour')`;
    await sql`INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version, geometry, published_at)
      VALUES (${routeId}, ${tenantId}, current_date, ${driverId}, ${vehicleId}, 'in_progress', 1,
        '[{"latitude": 51.5, "longitude": -0.1}, {"latitude": 51.51, "longitude": -0.11}]'::jsonb, now())`;
    await sql`INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no)
      VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${doneStop}, 1)`;
    await sql`INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no)
      VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${openStop}, 2)`;

    const close = await app.inject({
      method: "POST",
      url: "/v1/fleet/routes/close",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { vehicleId, version: 1, reason: "test close" },
    });
    expect(close.statusCode).toBe(200);

    const doneRows = await sql`
      SELECT status, arrived_at, completed_at FROM job_stops WHERE id = ${doneStop}
    `;
    expect(doneRows[0]?.status).toBe("arrived"); // untouched: job completed
    expect(doneRows[0]?.arrived_at).not.toBeNull();

    const openRows = await sql`
      SELECT status, arrived_at FROM job_stops WHERE id = ${openStop}
    `;
    expect(openRows[0]?.status).toBe("pending"); // reset
    expect(openRows[0]?.arrived_at).toBeNull(); // arrival cleared

    const openJobRows = await sql`
      SELECT status, assigned_driver_id FROM jobs WHERE id = ${openJob}
    `;
    expect(openJobRows[0]?.status).toBe("unassigned");
    expect(openJobRows[0]?.assigned_driver_id).toBeNull();

    const routeRows = await sql`
      SELECT status FROM routes WHERE id = ${routeId}
    `;
    expect(routeRows[0]?.status).toBe("cancelled");
  });
});
