/**
 * Episode lifecycle integration (docs/56 section 8): idempotent creation,
 * context refresh, consecutive-clear closure with a recorded reason, and
 * recurrence after closure.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import {
  activeEpisodes,
  applyAssessment,
  CLEARS_TO_CLOSE,
  evaluateDriverCommitments,
  evaluateStop,
} from "./episode-service.js";
import type { RiskAssessment } from "./commitment-risk.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "episode-test-secret-at-least-16-characters",
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

describe("exception episode lifecycle", () => {
  it("creates ONE active episode, refreshes it, closes only after consecutive clears, and allows recurrence", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Episode Co",
        email: `episode-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const tenantId = (register.json() as { tenant: { id: string } }).tenant.id;
    createdTenants.push(tenantId);
    const sql = migrator.sql;

    const jobId = randomUUID();
    const stopId = randomUUID();
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status)
      VALUES (${jobId}, ${tenantId}, 'EPS-1', 'Pickup', 'standard', 'assigned')`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', '1 Episode Way', 51.5, -0.1,
        now() - interval '30 minutes', now() + interval '45 minutes', 'pending')`;

    const threat: RiskAssessment = {
      kind: "threat",
      scope: "stop",
      scopeId: stopId,
      threatClass: "planned_breach",
      level: "late",
      reasons: ["planned arrival is after the committed window"],
      fingerprint: `stop:${stopId}:planned_breach`,
    };
    const none: RiskAssessment = { kind: "none", reasons: [] };

    // First observation: episode opens.
    const opened = await applyAssessment(migrator, tenantId, jobId, stopId, threat, 12);
    expect(opened?.status).toBe("open");
    expect(opened?.fingerprint).toBe(threat.fingerprint);
    expect(opened?.planVersion).toBe(12);

    // Repeated observation: still ONE active episode, context refreshed.
    await applyAssessment(migrator, tenantId, jobId, stopId, { ...threat, reasons: ["re-observed"] }, 13);
    const actives = await activeEpisodes(migrator, tenantId, jobId);
    expect(actives).toHaveLength(1);
    expect(actives[0]?.planVersion).toBe(13); // provenance refreshed, no duplicate

    // One clear observation is not enough to close.
    await applyAssessment(migrator, tenantId, jobId, stopId, none, null);
    expect(await activeEpisodes(migrator, tenantId, jobId)).toHaveLength(1);

    // Consecutive clears close with an explicitly recorded reason.
    for (let i = 1; i < CLEARS_TO_CLOSE; i += 1) {
      await applyAssessment(migrator, tenantId, jobId, stopId, none, null);
    }
    expect(await activeEpisodes(migrator, tenantId, jobId)).toHaveLength(0);
    const closed = (await sql`
      SELECT status, close_reason, closed_at FROM exception_episodes
      WHERE tenant_id = ${tenantId} AND fingerprint = ${threat.fingerprint}
      ORDER BY created_at DESC LIMIT 1
    `) as unknown as Array<{ status: string; close_reason: string; closed_at: string | null }>;
    expect(closed[0]?.status).toBe("closed");
    expect(closed[0]?.close_reason).toBe("threat_cleared");
    expect(closed[0]?.closed_at).not.toBeNull();

    // A genuinely new threat after closure creates a NEW episode (recurrence).
    const reopened = await applyAssessment(migrator, tenantId, jobId, stopId, threat, 14);
    expect(reopened?.status).toBe("open");
    expect(reopened?.id).not.toBe(opened?.id);
  });

  it("evaluateStop wires the pure engine to the episode store", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Evaluate Co",
        email: `evaluate-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const tenantId = (register.json() as { tenant: { id: string } }).tenant.id;
    createdTenants.push(tenantId);
    const sql = migrator.sql;
    const jobId = randomUUID();
    const stopId = randomUUID();
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status)
      VALUES (${jobId}, ${tenantId}, 'EVL-1', 'Pickup', 'standard', 'assigned')`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', '1 Evaluate Way', 51.5, -0.1,
        now() - interval '30 minutes', now() + interval '10 minutes', 'pending')`;

    const episode = await evaluateStop(
      migrator,
      tenantId,
      jobId,
      {
        nowMs: Date.now(),
        stopId,
        stopStatus: "pending",
        windowStart: new Date().toISOString(),
        windowEnd: new Date(Date.now() + 10 * 60000).toISOString(),
        plannedArrivalAt: new Date(Date.now() + 5 * 60000).toISOString(),
        fixCapturedAt: new Date().toISOString(),
        fixAccuracyMetres: 20,
        stationarySinceMs: 0,
      },
      3,
    );
    expect(episode?.threatClass).toBe("window_pressure");
    expect(episode?.reasons.join(" ")).toContain("window closes in");
  });

  it("evaluateDriverCommitments detects a stationary threat from live telemetry and closes on clear", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {
        tenantName: "Runner Co",
        email: `runner-${randomUUID().slice(0, 8)}@example.test`,
        password: "correct horse battery staple",
      },
    });
    const tenantId = (register.json() as { tenant: { id: string } }).tenant.id;
    createdTenants.push(tenantId);
    const sql = migrator.sql;

    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const jobId = randomUUID();
    const stopId = randomUUID();
    const routeId = randomUUID();
    await sql`INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id, latitude, longitude, captured_at)
      VALUES (${vehicleId}, ${tenantId}, 'RUN-1', 'Van', 'on_route', ${driverId}, 51.5, -0.1, now())`;
    await sql`INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
      VALUES (${driverId}, ${tenantId}, 'Runner Driver', 'on_route', 'unused', ${vehicleId}, now())`;
    await sql`INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
      VALUES (${jobId}, ${tenantId}, 'RUN-1', 'Pickup', 'standard', 'assigned', ${driverId}, ${vehicleId})`;
    await sql`INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status)
      VALUES (${stopId}, ${tenantId}, ${jobId}, 1, 'pickup', '1 Runner Way', 51.5, -0.1,
        now() - interval '30 minutes', now() + interval '25 minutes', 'pending')`;
    await sql`INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version, geometry)
      VALUES (${routeId}, ${tenantId}, current_date, ${driverId}, ${vehicleId}, 'published', 1,
        '[{"latitude": 51.5, "longitude": -0.1}, {"latitude": 51.51, "longitude": -0.11}]'::jsonb)`;
    await sql`INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no, planned_arrival_at)
      VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${stopId}, 1, now() + interval '20 minutes')`;
    // Stationary tail: last movement 20 minutes ago, stationary since.
    await sql`INSERT INTO location_points (tenant_id, vehicle_id, driver_id, captured_at, latitude, longitude, accuracy_metres, movement_state, sequence_no)
      VALUES (${tenantId}, ${vehicleId}, ${driverId}, now() - interval '20 minutes', 51.5, -0.1, 20, 'moving', 1)`;
    await sql`INSERT INTO location_points (tenant_id, vehicle_id, driver_id, captured_at, latitude, longitude, accuracy_metres, movement_state, sequence_no)
      VALUES (${tenantId}, ${vehicleId}, ${driverId}, now() - interval '10 minutes', 51.5, -0.1, 20, 'stationary', 2)`;
    await sql`INSERT INTO location_points (tenant_id, vehicle_id, driver_id, captured_at, latitude, longitude, accuracy_metres, movement_state, sequence_no)
      VALUES (${tenantId}, ${vehicleId}, ${driverId}, now(), 51.5, -0.1, 20, 'stationary', 3)`;

    await evaluateDriverCommitments(migrator, tenantId, driverId);
    const episodes = await activeEpisodes(migrator, tenantId, jobId);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]?.threatClass).toBe("stationary_diminishing_margin");
    expect(episodes[0]?.reasons.join(" ")).toContain("stationary");

    // Threat clears (healthy margin): closes only after consecutive clears.
    await sql`UPDATE job_stops SET window_end = now() + interval '2 hours' WHERE id = ${stopId}`;
    await evaluateDriverCommitments(migrator, tenantId, driverId);
    expect(await activeEpisodes(migrator, tenantId, jobId)).toHaveLength(1); // 1 clear: still open
    await evaluateDriverCommitments(migrator, tenantId, driverId);
    expect(await activeEpisodes(migrator, tenantId, jobId)).toHaveLength(0); // 2 clears: closed
    const closed = (await sql`
      SELECT status, close_reason FROM exception_episodes
      WHERE tenant_id = ${tenantId} AND job_id = ${jobId}
      ORDER BY created_at DESC LIMIT 1
    `) as unknown as Array<{ status: string; close_reason: string }>;
    expect(closed[0]?.status).toBe("closed");
    expect(closed[0]?.close_reason).toBe("threat_cleared");
  });
});
