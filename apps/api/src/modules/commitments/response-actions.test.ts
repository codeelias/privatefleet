/**
 * Response actions (docs/56 section 8, P1 slice 3): append-only typed events
 * on job_events, episode-correlated, idempotent by DB constraint, attempts
 * separate from outcomes, reassignment referencing the canonical assignment
 * event. Dispatcher-only via HTTP.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { recordResponseAction, responseEvents } from "./response-actions.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "response-test-secret-at-least-16-characters",
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

describe("response actions", () => {
  it("records attempts separately from outcomes, idempotently, with actor attribution and canonical reassignment reference", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Response Co",
        email: `response-${randomUUID().slice(0, 8)}@example.test`,
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

    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    const stopId = randomUUID();
    const episodeId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${tenantId}, 'RSP-1', 'Van', 'on_route', ${driverId})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id)
      VALUES (${driverId}, ${tenantId}, 'Response Driver', 'on_route', 'unused', ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${tenantId}, 'RSP-1', 'Pickup', 'standard', 'assigned', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', '1 Response Way', 51.5, -0.1,
        now() - interval '30 minutes', now() + interval '45 minutes', 'pending')`;
    // Canonical assignment event (what the existing assign flow writes).
    await sql`INSERT INTO job_events (tenant_id, job_id, type, actor_type, actor_id, payload)
      VALUES (${tenantId}, ${jobId}, 'job.assigned', 'user', ${randomUUID()}, '{"driverId":"x"}'::jsonb)`;
    // A real episode for correlation.
    await sql`INSERT INTO exception_episodes (id, tenant_id, job_id, stop_id, threat_class, level, fingerprint, reasons, status)
      VALUES (${episodeId}, ${tenantId}, ${jobId}, ${stopId}, 'planned_breach', 'late',
        ${`stop:${stopId}:planned_breach`}, '[]'::jsonb, 'open')`;

    // 1. Attempt and outcome are SEPARATE events.
    const attemptKey = randomUUID();
    const actorId = randomUUID();
    const attempt = await recordResponseAction(migrator, tenantId, jobId, actorId, {
      episodeId, actionType: "contact_driver", stage: "attempt", idempotencyKey: attemptKey,
      payload: { channel: "phone" },
    });
    expect(attempt.eventId).toBeTruthy();
    const confirmed = await recordResponseAction(migrator, tenantId, jobId, actorId, {
      episodeId, actionType: "contact_driver", stage: "confirmed", idempotencyKey: randomUUID(),
      payload: { channel: "phone", reached: true },
    });
    expect(confirmed.eventId).toBeTruthy();

    // 2. Idempotency: same key + same payload = replay (ONE event, original id).
    const replay = await recordResponseAction(migrator, tenantId, jobId, actorId, {
      episodeId, actionType: "contact_driver", stage: "attempt", idempotencyKey: attemptKey,
      payload: { channel: "phone" },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.conflict).toBe(false);
    expect(replay.eventId).toBe(attempt.eventId);

    // 2b. Same key + DIFFERENT payload = conflict, and NO new event is written.
    const conflict = await recordResponseAction(migrator, tenantId, jobId, actorId, {
      episodeId, actionType: "contact_driver", stage: "attempt", idempotencyKey: attemptKey,
      payload: { channel: "phone", different: true },
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.eventId).toBeNull();
    const events = await responseEvents(migrator, tenantId, episodeId);
    expect(events).toHaveLength(2); // attempt + confirmed only; conflict wrote nothing
    expect(events[0]?.type).toBe("response.contact_driver");
    expect(events[0]?.actorId).toBe(actorId);
    const stages = new Set(
      events.map((event) => (event.payload as { stage: string }).stage),
    );
    expect(stages).toEqual(new Set(["attempt", "confirmed"]));

    // 3. Reassignment references the canonical assignment event, no duplication.
    await recordResponseAction(migrator, tenantId, jobId, actorId, {
      episodeId, actionType: "reassign", stage: "confirmed", idempotencyKey: randomUUID(),
      payload: { fromDriverId: driverId, toDriverId: randomUUID() },
    });
    const reassignEvents = await responseEvents(migrator, tenantId, episodeId);
    const reassignPayload = reassignEvents.find((event) => event.type === "response.reassign")?.payload as {
      assignment_event_id?: string;
    };
    expect(reassignPayload?.assignment_event_id).toBeTruthy();
    const canonicalCount = (await sql`
      SELECT count(*)::int AS count FROM job_events
      WHERE tenant_id = ${tenantId} AND job_id = ${jobId} AND type = 'job.assigned'
    `) as unknown as Array<{ count: number }>;
    expect(canonicalCount[0]?.count).toBe(1); // referenced, never duplicated

    // 4. HTTP: dispatcher-only; replay 200; different-payload reuse 409 conflict.
    const viaHttp = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${jobId}/response`,
      headers: authed,
      payload: {
        episodeId, actionType: "other", stage: "confirmed",
        idempotencyKey: randomUUID(), payload: { note: "checked with customer" },
      },
    });
    expect(viaHttp.statusCode).toBe(200);

    const replayHttp = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${jobId}/response`,
      headers: authed,
      payload: {
        episodeId, actionType: "contact_driver", stage: "attempt",
        idempotencyKey: attemptKey, payload: { channel: "phone" },
      },
    });
    expect(replayHttp.statusCode).toBe(200);
    expect((replayHttp.json() as { replayed: boolean }).replayed).toBe(true);

    const conflictHttp = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${jobId}/response`,
      headers: authed,
      payload: {
        episodeId, actionType: "contact_driver", stage: "attempt",
        idempotencyKey: attemptKey, payload: { channel: "phone", different: true },
      },
    });
    expect(conflictHttp.statusCode).toBe(409);
    expect((conflictHttp.json() as { code: string }).code).toBe("IDEMPOTENCY_CONFLICT");

    const list = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${jobId}/episodes/${episodeId}/responses`,
      headers: authed,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { responses: unknown[] }).responses.length).toBe(4);
  });

  it("rejects driver tokens for response actions", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Response Gate Co",
        email: `rgate-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const session = register.json() as { tenant: { id: string; slug: string } };
    createdTenants.push(session.tenant.id);
    const sql = migrator.sql;
    const pinHash = await argonHash("1234");
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id)
      VALUES (${vehicleId}, ${session.tenant.id}, 'RSP-2', 'Van', 'on_route', ${driverId})`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id)
      VALUES (${driverId}, ${session.tenant.id}, 'Gate Driver', 'on_route', ${pinHash}, ${vehicleId})`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${session.tenant.id}, 'RSP-2', 'Pickup', 'standard', 'assigned', ${driverId}, ${vehicleId})`;
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/driver-login",
      payload: { tenantSlug: session.tenant.slug, driverId, pin: "1234" },
    });
    expect(login.statusCode).toBe(200);
    const driverToken = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const res = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${jobId}/response`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: {
        episodeId: randomUUID(), actionType: "other", stage: "attempt",
        idempotencyKey: randomUUID(), payload: {},
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe("RESPONSE_DISPATCHER_ONLY");
  });
});

