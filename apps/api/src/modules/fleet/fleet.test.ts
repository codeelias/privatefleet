/**
 * Phase 2 lifecycle gate: server-authoritative commands, command
 * idempotency, transactional outbox, and cross-tenant isolation on the
 * API surface. Runs against real Postgres with the non-owner app role.
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
  AUTH_JWT_SECRET: "test-secret-at-least-16-characters-long",
  LOG_LEVEL: "error",
});

const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });

interface Fixture {
  tenantId: string;
  slug: string;
  token: string;
  driverId: string;
  vehicleId: string;
  jobId: string;
  stopId: string;
  alertId: string;
}

const createdTenants: string[] = [];

async function registerTenant(name: string): Promise<{ tenantId: string; slug: string; token: string }> {
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

async function seedFleet(tenantId: string): Promise<{
  driverId: string;
  vehicleId: string;
  jobId: string;
  stopId: string;
  alertId: string;
}> {
  const driverId = randomUUID();
  const vehicleId = randomUUID();
  const jobId = randomUUID();
  const stopId = randomUUID();
  const alertId = randomUUID();
  const sql = migrator.sql;
  await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
    VALUES (${vehicleId}, ${tenantId}, ${"VAN-" + randomUUID().slice(0, 4)}, 'Van', 'available', ${driverId})`;
  await sql`INSERT INTO drivers (id, tenant_id, full_name, status, vehicle_id, last_ping_at)
    VALUES (${driverId}, ${tenantId}, 'Test Driver', 'available', ${vehicleId}, now())`;
  await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status)
    VALUES (${jobId}, ${tenantId}, ${"J-T" + randomUUID().slice(0, 4)}, 'Pickup', 'standard', 'unassigned')`;
  await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address,
      latitude, longitude, window_start, window_end, status)
    VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', 'Test Street, London',
      51.5, -0.1, now(), now() + interval '1 hour', 'pending')`;
  await sql`INSERT INTO alerts (id, tenant_id, severity, status, title, entity, location, freshness, recommended_action)
    VALUES (${alertId}, ${tenantId}, 'info', 'open', 'Test alert', 'Test', 'London', 'now', 'none')`;
  return { driverId, vehicleId, jobId, stopId, alertId };
}

function authed(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

let a: Fixture;
let b: { tenantId: string; token: string };

beforeAll(async () => {
  await app.ready();
  const tenant = await registerTenant("Lifecycle Alpha");
  const fleet = await seedFleet(tenant.tenantId);
  a = { ...tenant, ...fleet };
  b = await registerTenant("Lifecycle Beta");
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

describe("fleet snapshot", () => {
  it("returns the tenant's fleet and hides other tenants", async () => {
    const own = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: authed(a.token),
    });
    expect(own.statusCode).toBe(200);
    const ownBody = own.json() as {
      jobs: Array<{ id: string; version: number }>;
      drivers: unknown[];
      demoMode: boolean;
    };
    expect(ownBody.demoMode).toBe(false);
    expect(ownBody.jobs.some((job) => job.id === a.jobId)).toBe(true);
    expect(ownBody.drivers.length).toBeGreaterThanOrEqual(1);

    const foreign = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: authed(b.token),
    });
    const foreignBody = foreign.json() as { jobs: unknown[] };
    expect(foreignBody.jobs.length).toBe(0);

    const anonymous = await app.inject({ method: "GET", url: "/v1/fleet/state" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("serves a lightweight state without route geometry and a separate versioned route read", async () => {
    const light = await app.inject({
      method: "GET",
      url: "/v1/fleet/state?includeRoutes=false",
      headers: authed(a.token),
    });
    expect(light.statusCode).toBe(200);
    const body = light.json() as {
      routes: unknown[];
      jobs: unknown[];
      routeVersion: number;
      demoMode: boolean;
    };
    expect(body.demoMode).toBe(false);
    expect(body.routes).toEqual([]);
    expect(body.jobs.length).toBeGreaterThan(0);
    expect(body.routeVersion).toBeGreaterThanOrEqual(1);

    const routes = await app.inject({
      method: "GET",
      url: "/v1/fleet/routes",
      headers: authed(a.token),
    });
    expect(routes.statusCode).toBe(200);
    expect((routes.json() as { routes: unknown[] }).routes).toEqual([]);

    const foreignRoutes = await app.inject({
      method: "GET",
      url: "/v1/fleet/routes",
      headers: authed(b.token),
    });
    expect((foreignRoutes.json() as { routes: unknown[] }).routes).toEqual([]);

    const anonymousRoutes = await app.inject({ method: "GET", url: "/v1/fleet/routes" });
    expect(anonymousRoutes.statusCode).toBe(401);
  });
});

describe("assignment lifecycle", () => {
  it("assigns with an idempotency key and replays the same response", async () => {
    const key = randomUUID();
    const first = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/assign`,
      headers: { ...authed(a.token), "idempotency-key": key },
      payload: { driverId: a.driverId },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { jobId: string; status: string; etaImpactMinutes: number };
    expect(firstBody.jobId).toBe(a.jobId);
    expect(firstBody.status).toBe("assigned");

    const replay = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/assign`,
      headers: { ...authed(a.token), "idempotency-key": key },
      payload: { driverId: a.driverId },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(firstBody);

    // Exactly one audit event and one outbox row for the command.
    const events = (await migrator.sql`
      SELECT count(*)::int AS count FROM job_events
      WHERE tenant_id = ${a.tenantId} AND job_id = ${a.jobId}
    `) as unknown as Array<{ count: number }>;
    expect(events[0]?.count).toBe(1);
    const outbox = (await migrator.sql`
      SELECT count(*)::int AS count FROM outbox
      WHERE tenant_id = ${a.tenantId} AND event_type = 'job.assigned'
    `) as unknown as Array<{ count: number }>;
    expect(outbox[0]?.count).toBe(1);
  });

  it("rejects a second assignment with a conflict", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/assign`,
      headers: { ...authed(a.token), "idempotency-key": randomUUID() },
      payload: { driverId: a.driverId },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("JOB_ASSIGNMENT_CONFLICT");
  });

  it("drives arrive -> complete and refuses illegal transitions", async () => {
    const arrived = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/stops/${a.stopId}/arrive`,
      headers: authed(a.token),
      payload: { driverId: a.driverId },
    });
    expect(arrived.statusCode).toBe(200);

    const completed = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/stops/${a.stopId}/complete`,
      headers: authed(a.token),
      payload: { driverId: a.driverId, recipientName: "J. Smith" },
    });
    expect(completed.statusCode).toBe(200);
    const completedBody = completed.json() as { jobStatus: string };
    expect(completedBody.jobStatus).toBe("completed");

    const again = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/stops/${a.stopId}/complete`,
      headers: authed(a.token),
      payload: { driverId: a.driverId },
    });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { code: string }).code).toBe("INVALID_STOP_TRANSITION");
  });

  it("rejects a driver who is not assigned to the stop", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${a.jobId}/stops/${a.stopId}/arrive`,
      headers: authed(a.token),
      payload: { driverId: randomUUID() },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("STOP_NOT_ASSIGNED_TO_DRIVER");
  });
});

describe("alert triage", () => {
  it("acknowledges an alert with an audit entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/alerts/${a.alertId}/acknowledge`,
      headers: authed(a.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { acknowledged: boolean; audit: unknown[] };
    expect(body.acknowledged).toBe(true);
    expect(body.audit.length).toBe(1);
  });
});
