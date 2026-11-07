/**
 * Customer notifications (docs/54 R6): consent-gated, event-driven, honest
 * status. With no SMTP configured the attempt is recorded as failed with a
 * truthful detail - delivery is never claimed.
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
  AUTH_JWT_SECRET: "notification-test-secret-at-least-16-characters",
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

describe("customer notifications", () => {
  it("consent-gates, records honest status, and validates the email", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Notify Co",
        email: `notify-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const session = register.json() as {
      tenant: { id: string; slug: string };
      tokens: { accessToken: string };
    };
    const tenantId = session.tenant.id;
    createdTenants.push(tenantId);
    const ownerToken = session.tokens.accessToken;
    const authed = { authorization: `Bearer ${ownerToken}` };

    const sql = migrator.sql;
    const pinHash = await argonHash("1234");
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    const stopId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id, latitude, longitude, captured_at)
      VALUES (${vehicleId}, ${tenantId}, 'NTF-1', 'Van', 'on_route', ${driverId}, 51.5, -0.1, now())`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
      VALUES (${driverId}, ${tenantId}, 'Notify Driver', 'on_route', ${pinHash}, ${vehicleId}, now())`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${tenantId}, 'NTF-1', 'Pickup', 'standard', 'assigned', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', '1 Notify Way', 51.5, -0.1, now(), now() + interval '2 hours', 'pending')`;

    // Invalid email with notifications enabled is rejected.
    const bad = await app.inject({
      method: "POST",
      url: "/v1/tracking-tokens",
      headers: authed,
      payload: { jobId, notifyEnabled: true, recipientEmail: "not-an-email" },
    });
    expect(bad.statusCode).toBe(400);

    // Consent-gated token with a valid email.
    const created = await app.inject({
      method: "POST",
      url: "/v1/tracking-tokens",
      headers: authed,
      payload: { jobId, notifyEnabled: true, recipientEmail: "customer@example.test" },
    });
    expect(created.statusCode).toBe(200);

    // Driver completes the job: the pipeline enqueues and attempts delivery.
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/driver-login",
      payload: { tenantSlug: session.tenant.slug, driverId, pin: "1234" },
    });
    const driverToken = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const arrive = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/stops/${stopId}/arrive`,
      headers: { ...authed, "idempotency-key": randomUUID() },
      payload: { driverId },
    });
    expect(arrive.statusCode).toBe(200);
    const complete = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/stops/${stopId}/complete`,
      headers: { authorization: `Bearer ${driverToken}`, "idempotency-key": randomUUID() },
      payload: { driverId, recipientName: "Notify Recipient" },
    });
    expect(complete.statusCode).toBe(200);

    // The pipeline runs asynchronously off the bus; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const list = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: authed,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as {
      notifications: Array<{ jobId: string; eventType: string; status: string; detail: string | null; recipient: string }>;
    }).notifications;
    const forJob = rows.filter((row) => row.jobId === jobId);
    expect(forJob.length).toBeGreaterThan(0);
    // No SMTP server: honest failure, never a false claim of delivery.
    expect(forJob.every((row) => row.status === "failed")).toBe(true);
    expect(forJob.every((row) => row.detail === "SMTP not configured")).toBe(true);
    expect(forJob[0]?.recipient).toBe("customer@example.test");
  });
});
