/**
 * Phase 3 driver workflow gate (docs/06, docs/14): device login, tenant
 * and driver-scoped queue, driver-authorized actions, idempotent replay,
 * and the dispatcher seeing the authorised update.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { seedTenant } from "../../db/seed.js";

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

interface DriverFixture {
  tenantId: string;
  slug: string;
  ownerToken: string;
  driverA: { id: string; vehicleId: string; jobId: string; stopId: string };
  driverB: { id: string; vehicleId: string; jobId: string; stopId: string };
}

async function registerTenant(name: string): Promise<{
  tenantId: string;
  slug: string;
  token: string;
}> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      tenantName: name,
      email: `owner-${randomUUID().slice(0, 8)}@example.test`,
      password: "correct horse battery staple",
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`register failed: ${res.body}`);
  }
  const session = res.json() as {
    tenant: { id: string; slug: string };
    tokens: { accessToken: string };
  };
  createdTenants.push(session.tenant.id);
  return {
    tenantId: session.tenant.id,
    slug: session.tenant.slug,
    token: session.tokens.accessToken,
  };
}

async function seedDriverFleet(fixture: DriverFixture): Promise<void> {
  const sql = migrator.sql;
  const pinHash = await argonHash("1234");
  for (const driver of [fixture.driverA, fixture.driverB]) {
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${driver.vehicleId}, ${fixture.tenantId}, ${"VAN-" + randomUUID().slice(0, 4)}, 'Van', 'available', ${driver.id})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
      VALUES (${driver.id}, ${fixture.tenantId}, ${"Driver " + driver.id.slice(0, 4)}, 'available', ${pinHash}, ${driver.vehicleId}, now())`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${driver.jobId}, ${fixture.tenantId}, ${"J-" + randomUUID().slice(0, 4)}, 'Pickup', 'standard', 'assigned', ${driver.id}, ${driver.vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address,
        latitude, longitude, window_start, window_end, status)
      VALUES (${driver.stopId}, ${fixture.tenantId}, ${driver.jobId}, 1, 'pickup', 'Test Street, London',
        51.5, -0.1, now(), now() + interval '1 hour', 'pending')`;
  }
}

function authed(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

let fleet: DriverFixture;

beforeAll(async () => {
  await app.ready();
  const tenant = await registerTenant("Driver Workflow Co");
  fleet = {
    tenantId: tenant.tenantId,
    slug: tenant.slug,
    ownerToken: tenant.token,
    driverA: {
      id: randomUUID(),
      vehicleId: randomUUID(),
      jobId: randomUUID(),
      stopId: randomUUID(),
    },
    driverB: {
      id: randomUUID(),
      vehicleId: randomUUID(),
      jobId: randomUUID(),
      stopId: randomUUID(),
    },
  };
  await seedDriverFleet(fleet);
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

async function driverLogin(driverId: string, pin = "1234"): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/driver-login",
    payload: { tenantSlug: fleet.slug, driverId, pin },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { tokens: { accessToken: string } }).tokens.accessToken;
}

describe("driver device login", () => {
  it("issues a driver session for the correct PIN", async () => {
    const token = await driverLogin(fleet.driverA.id);
    const queue = await app.inject({
      method: "GET",
      url: "/v1/driver/queue",
      headers: authed(token),
    });
    expect(queue.statusCode).toBe(200);
    const body = queue.json() as { driver: { id: string }; jobs: Array<{ id: string }> };
    expect(body.driver.id).toBe(fleet.driverA.id);
  });

  it("rejects a wrong PIN and an unknown driver without leaking details", async () => {
    const wrongPin = await app.inject({
      method: "POST",
      url: "/v1/auth/driver-login",
      payload: { tenantSlug: fleet.slug, driverId: fleet.driverA.id, pin: "9999" },
    });
    expect(wrongPin.statusCode).toBe(401);
    expect((wrongPin.json() as { code: string }).code).toBe("INVALID_CREDENTIALS");

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/driver-login",
      payload: { tenantSlug: fleet.slug, driverId: randomUUID(), pin: "1234" },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it("refuses staff sessions and other tenants on the driver queue", async () => {
    const staff = await app.inject({
      method: "GET",
      url: "/v1/driver/queue",
      headers: authed(fleet.ownerToken),
    });
    expect(staff.statusCode).toBe(403);

    const otherTenant = await registerTenant("Other Tenant Co");
    const crossTenant = await app.inject({
      method: "POST",
      url: "/v1/auth/driver-login",
      payload: { tenantSlug: otherTenant.slug, driverId: fleet.driverA.id, pin: "1234" },
    });
    expect(crossTenant.statusCode).toBe(401);
  });
});

describe("driver-scoped assignments", () => {
  it("shows only the driver's own jobs", async () => {
    const tokenA = await driverLogin(fleet.driverA.id);
    const queue = await app.inject({
      method: "GET",
      url: "/v1/driver/queue",
      headers: authed(tokenA),
    });
    const body = queue.json() as { jobs: Array<{ id: string }> };
    expect(body.jobs.map((job) => job.id)).toEqual([fleet.driverA.jobId]);
  });

  it("lets the driver start their shift", async () => {
    const token = await driverLogin(fleet.driverA.id);
    const shift = await app.inject({
      method: "POST",
      url: "/v1/driver/shift/start",
      headers: authed(token),
    });
    expect(shift.statusCode).toBe(200);
    expect((shift.json() as { status: string }).status).toBe("on_route");
  });

  it("cannot act on another driver's stop (token identity wins)", async () => {
    const tokenA = await driverLogin(fleet.driverA.id);
    const spoof = await app.inject({
      method: "POST",
      url: `/v1/jobs/${fleet.driverB.jobId}/stops/${fleet.driverB.stopId}/arrive`,
      headers: authed(tokenA),
      payload: { driverId: fleet.driverA.id },
    });
    expect(spoof.statusCode).toBe(403);

    const mismatched = await app.inject({
      method: "POST",
      url: `/v1/jobs/${fleet.driverA.jobId}/stops/${fleet.driverA.stopId}/arrive`,
      headers: authed(tokenA),
      payload: { driverId: fleet.driverB.id },
    });
    expect(mismatched.statusCode).toBe(403);
  });
});

describe("seeded single-stop job (device acceptance fixture)", () => {
  it("completes J-000 through arrive + complete", async () => {
    const seeded = await seedTenant(migrator, {
      tenantName: "Seeded Device Co",
      email: "owner@seeded.demo",
      password: "demo-password-123",
      slug: `seeded-${randomUUID().slice(0, 6)}`,
    });
    createdTenants.push(seeded.tenantId);
    const owner = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { tenantSlug: seeded.tenantSlug, email: seeded.email, password: seeded.password },
    });
    expect(owner.statusCode).toBe(200);
    const ownerToken = (owner.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const state = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: authed(ownerToken),
    });
    const job = (state.json() as { jobs: Array<{ id: string; reference: string; assignedDriverId?: string; stops: Array<{ id: string; status: string }> }> }).jobs.find(
      (candidate) => candidate.reference === "J-000",
    );
    expect(job).toBeTruthy();
    expect(job!.stops.length).toBe(1);
    const driverRes = await app.inject({
      method: "POST",
      url: "/v1/auth/driver-login",
      payload: { tenantSlug: seeded.tenantSlug, driverId: job!.assignedDriverId, pin: "1234" },
    });
    expect(driverRes.statusCode).toBe(200);
    const driverToken = (driverRes.json() as { tokens: { accessToken: string } }).tokens.accessToken;

    const arrive = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job!.id}/stops/${job!.stops[0]!.id}/arrive`,
      headers: { ...authed(driverToken), "idempotency-key": randomUUID() },
      payload: { driverId: job!.assignedDriverId },
    });
    expect(arrive.statusCode).toBe(200);
    const complete = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job!.id}/stops/${job!.stops[0]!.id}/complete`,
      headers: { ...authed(driverToken), "idempotency-key": randomUUID() },
      payload: { driverId: job!.assignedDriverId, recipientName: "Seeded Recipient" },
    });
    expect(complete.statusCode).toBe(200);
    const finalState = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: authed(ownerToken),
    });
    const finalJob = (finalState.json() as { jobs: Array<{ id: string; status: string; stops: Array<{ status: string }> }> }).jobs.find(
      (candidate) => candidate.id === job!.id,
    );
    expect(finalJob?.status).toBe("completed");
    expect(finalJob?.stops.every((stop) => stop.status === "completed")).toBe(true);
  });
});

describe("driver actions reach dispatch", () => {
  it("arrives and completes with idempotent replay, dispatcher sees it", async () => {
    const tokenA = await driverLogin(fleet.driverA.id);
    const commandKey = randomUUID();

    const arrive = await app.inject({
      method: "POST",
      url: `/v1/jobs/${fleet.driverA.jobId}/stops/${fleet.driverA.stopId}/arrive`,
      headers: { ...authed(tokenA), "idempotency-key": commandKey },
      payload: { driverId: fleet.driverA.id },
    });
    expect(arrive.statusCode).toBe(200);
    const arriveReplay = await app.inject({
      method: "POST",
      url: `/v1/jobs/${fleet.driverA.jobId}/stops/${fleet.driverA.stopId}/arrive`,
      headers: { ...authed(tokenA), "idempotency-key": commandKey },
      payload: { driverId: fleet.driverA.id },
    });
    expect(arriveReplay.statusCode).toBe(200);
    expect(arriveReplay.json()).toEqual(arrive.json());

    const complete = await app.inject({
      method: "POST",
      url: `/v1/jobs/${fleet.driverA.jobId}/stops/${fleet.driverA.stopId}/complete`,
      headers: { ...authed(tokenA), "idempotency-key": randomUUID() },
      payload: { driverId: fleet.driverA.id, recipientName: "Test Recipient" },
    });
    expect(complete.statusCode).toBe(200);
    expect((complete.json() as { jobStatus: string }).jobStatus).toBe("completed");

    // Dispatcher view: the same tenant state shows the completed job.
    const dispatch = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: authed(fleet.ownerToken),
    });
    expect(dispatch.statusCode).toBe(200);
    const state = dispatch.json() as {
      jobs: Array<{ id: string; status: string }>;
    };
    const jobA = state.jobs.find((job) => job.id === fleet.driverA.jobId);
    expect(jobA?.status).toBe("completed");

    // Driver B's job is untouched by driver A's commands.
    const jobB = state.jobs.find((job) => job.id === fleet.driverB.jobId);
    expect(jobB?.status).toBe("assigned");

    // Exactly one completion event was recorded for the command.
    const events = (await migrator.sql`
      SELECT count(*)::int AS count FROM job_events
      WHERE tenant_id = ${fleet.tenantId} AND job_id = ${fleet.driverA.jobId}
        AND type = 'job.completed'
    `) as unknown as Array<{ count: number }>;
    expect(events[0]?.count).toBe(1);
  });
});

