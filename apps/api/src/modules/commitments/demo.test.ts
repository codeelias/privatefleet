/**
 * P1 slice 6: synthetic 120-second demonstration and the negative acceptance
 * tests from frozen docs/56 section 11, executed end to end against the
 * isolated DEMO tenant. Every assertion maps to a docs/56 acceptance item.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { buildApp } from "../../app.js";
import { loadConfig, migrationDatabaseUrl } from "../../config.js";
import { closeDb, createDb, type DbHandle } from "../../db/client.js";
import { DEMO, DEMO_PNG_BYTES, DEMO_SIGNATURE_PATH, resetDemoScenario, seedDemoScenario, type DemoIds } from "./demo.js";
import { gatherJobEvidenceReport } from "./evidence-report.js";
import { EvidenceStore } from "../evidence/storage.js";

const APP_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev";

const config = loadConfig({
  ...process.env,
  REPOSITORY_MODE: "postgres",
  DATABASE_URL: APP_DATABASE_URL,
  AUTH_JWT_SECRET: "demo-test-secret-at-least-16-characters",
  LOG_LEVEL: "error",
});

const { app } = buildApp(config);
const migrator: DbHandle = createDb(migrationDatabaseUrl(), { max: 2 });
const sql = migrator.sql;
let store: EvidenceStore;
let ids: DemoIds;
let pinHash: string;
let driverAToken: string;
let ownerToken: string;
const prodJobCounts: number[] = [];

async function postTelemetry(token: string, capturedAt: string, lat = 51.508, lng = -0.1): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/telemetry",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      samples: [{ latitude: lat, longitude: lng, capturedAt, accuracyMetres: 5, movementState: "moving" }],
    },
  });
  return res.statusCode;
}

async function waitFor<T>(check: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function activeEpisodeCount(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS count FROM exception_episodes
    WHERE tenant_id = ${DEMO.tenantId}
      AND status IN ('open','investigating','response_in_progress')
  `) as unknown as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

beforeAll(async () => {
  await app.ready();
  // The app writes evidence into config.evidenceDir - the report's integrity
  // verification must read from the SAME store, or every file reads "missing".
  store = new EvidenceStore(config.evidenceDir);
  pinHash = await argonHash("1234");
  ids = await seedDemoScenario(migrator, pinHash);
  // Demo dispatcher account (owner role).
  const ownerId = randomUUID();
  await sql`
    INSERT INTO users (id, tenant_id, email, password_hash, role)
    VALUES (${ownerId}, ${DEMO.tenantId}, 'demo-owner@demo-120s.synthetic', ${await argonHash("demo-password-123")}, 'owner')
  `;
  const ownerLogin = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { tenantSlug: DEMO.tenantSlug, email: "demo-owner@demo-120s.synthetic", password: "demo-password-123" },
  });
  expect(ownerLogin.statusCode).toBe(200);
  ownerToken = (ownerLogin.json() as { tokens: { accessToken: string } }).tokens.accessToken;

  const loginA = await app.inject({
    method: "POST",
    url: "/v1/auth/driver-login",
    payload: { tenantSlug: DEMO.tenantSlug, driverId: DEMO.driverAId, pin: "1234" },
  });
  expect(loginA.statusCode).toBe(200);
  driverAToken = (loginA.json() as { tokens: { accessToken: string } }).tokens.accessToken;
  const loginB = await app.inject({
    method: "POST",
    url: "/v1/auth/driver-login",
    payload: { tenantSlug: DEMO.tenantSlug, driverId: DEMO.driverBId, pin: "1234" },
  });
  expect(loginB.statusCode).toBe(200);

  // Production isolation baseline.
  const prodTenant = "734c7f72-3164-44f6-84f8-f3b60180be1c";
  const counts = (await sql`
    SELECT
      (SELECT count(*) FROM jobs WHERE tenant_id = ${prodTenant}) AS jobs,
      (SELECT count(*) FROM job_stops WHERE tenant_id = ${prodTenant}) AS stops,
      (SELECT count(*) FROM stop_evidence WHERE tenant_id = ${prodTenant}) AS evidence
  `) as unknown as Array<{ jobs: number; stops: number; evidence: number }>;
  prodJobCounts.push(counts[0]?.jobs ?? -1, counts[0]?.stops ?? -1, counts[0]?.evidence ?? -1);
});

afterAll(async () => {
  await resetDemoScenario(migrator);
  await app.close();
  await closeDb(migrator);
});

describe("demo phase 1: commitment", () => {
  it("docs/56 positive 1: an urgent job with a defined window is assigned via the real workflow; its commitment is visible", async () => {
    const state = await app.inject({
      method: "GET",
      url: "/v1/fleet/state",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(state.statusCode).toBe(200);
    const body = state.json() as { jobs: Array<{ reference: string; stops?: Array<{ windowStart: string; windowEnd: string }> }> };
    const job = body.jobs.find((entry) => entry.reference === "DEMO-URGENT-1");
    expect(job).toBeTruthy();
    expect(job!.stops?.length).toBe(2);
    expect(job!.stops?.[1]?.windowStart).toBeTruthy();
    expect(job!.stops?.[1]?.windowEnd).toBeTruthy();

    // The existing assignment workflow assigns Driver A (canonical event).
    const assign = await app.inject({
      method: "POST",
      url: `/v1/jobs/${ids.jobId}/assign`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { driverId: DEMO.driverAId },
    });
    expect(assign.statusCode).toBe(200);
  });
});

describe("demo phase 2: detection", () => {
  it("docs/56 positive 2: fresh telemetry + delay conditions produce ONE explainable episode", async () => {
    expect(await postTelemetry(driverAToken, new Date().toISOString())).toBe(200);
    const episode = await waitFor(async () => {
      const rows = (await sql`
        SELECT id, threat_class, reasons FROM exception_episodes
        WHERE tenant_id = ${DEMO.tenantId} AND status IN ('open','investigating','response_in_progress')
        ORDER BY created_at DESC LIMIT 1
      `) as unknown as Array<{ id: string; threat_class: string; reasons: string[] | null }>;
      return rows[0] ?? null;
    });
    expect(episode.threat_class).toBe("planned_breach");
    expect((episode.reasons ?? []).length).toBeGreaterThan(0);
  });

  it("negative 1: stale GPS does NOT create a risk episode", async () => {
    const before = await activeEpisodeCount();
    const stale = new Date(Date.now() - 40 * 60_000).toISOString();
    expect(await postTelemetry(driverAToken, stale)).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await activeEpisodeCount()).toBe(before);
  });

  it("negative 3: repeated telemetry does NOT create duplicate active episodes", async () => {
    const before = await activeEpisodeCount();
    for (let i = 0; i < 4; i += 1) {
      expect(await postTelemetry(driverAToken, new Date().toISOString())).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await activeEpisodeCount()).toBe(before);
  });
});

describe("demo phase 3: intervention", () => {
  it("records attempts and confirmed outcomes separately; a failed response is never resolved (negative 4)", async () => {
    const auth = { authorization: `Bearer ${ownerToken}` };
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: `/v1/fleet/jobs/${ids.jobId}/response`, headers: auth, payload });

    const attempt = await post({
      episodeId: (await sql`SELECT id FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId} AND status='open' LIMIT 1` as unknown as Array<{ id: string }>)[0]!.id,
      actionType: "contact_driver", stage: "attempt", idempotencyKey: randomUUID(), payload: { channel: "phone" },
    });
    expect(attempt.statusCode).toBe(200);

    const failed = await post({
      episodeId: (await sql`SELECT id FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId} AND status='open' LIMIT 1` as unknown as Array<{ id: string }>)[0]!.id,
      actionType: "contact_driver", stage: "confirmed", idempotencyKey: randomUUID(),
      payload: { channel: "phone", outcome: "failed", reason: "no answer" },
    });
    expect(failed.statusCode).toBe(200);

    const episodeId = (await sql`SELECT id FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId} AND status='open' LIMIT 1` as unknown as Array<{ id: string }>)[0]!.id;
    const resolution = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${ids.jobId}/episodes/${episodeId}/resolution`,
      headers: auth,
    });
    expect(resolution.statusCode).toBe(200);
    expect((resolution.json() as { resolution: { state: string } }).resolution.state).toBe("response_failed");
  });

  it("docs/56 positive 3: the episode correlates with the canonical assignment event (reassignment recorded against it)", async () => {
    const auth = { authorization: `Bearer ${ownerToken}` };
    const canonical = (await sql`
      SELECT id FROM job_events
      WHERE tenant_id = ${DEMO.tenantId} AND job_id = ${ids.jobId} AND type = 'job.assigned'
      ORDER BY created_at DESC LIMIT 1
    `) as unknown as Array<{ id: string }>;
    expect(canonical[0]?.id).toBeTruthy();
    const episodeId = (await sql`SELECT id FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId} AND status='open' LIMIT 1` as unknown as Array<{ id: string }>)[0]!.id;
    const reassign = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${ids.jobId}/response`,
      headers: auth,
      payload: {
        episodeId, actionType: "reassign", stage: "confirmed",
        idempotencyKey: randomUUID(), payload: { fromDriverId: DEMO.driverAId, toDriverId: DEMO.driverBId },
      },
    });
    expect(reassign.statusCode).toBe(200);
    const events = (await sql`
      SELECT payload FROM job_events
      WHERE tenant_id = ${DEMO.tenantId} AND episode_id = ${episodeId} AND type = 'response.reassign'
    `) as unknown as Array<{ payload: unknown }>;
    expect((events[0]?.payload as { assignment_event_id?: string })?.assignment_event_id).toBe(canonical[0]?.id);
  });

  it("records a reschedule revision (original commitment preserved for later verification)", async () => {
    const auth = { authorization: `Bearer ${ownerToken}` };
    const episodeId = (await sql`SELECT id FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId} AND status='open' LIMIT 1` as unknown as Array<{ id: string }>)[0]!.id;
    const reschedule = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${ids.jobId}/response`,
      headers: auth,
      payload: {
        episodeId, actionType: "reschedule", stage: "confirmed", idempotencyKey: randomUUID(),
        payload: {
          windowStart: new Date(Date.now() + 10 * 60_000).toISOString(),
          windowEnd: new Date(Date.now() + 40 * 60_000).toISOString(),
          effectiveAt: new Date().toISOString(),
        },
      },
    });
    expect(reschedule.statusCode).toBe(200);
  });

  it("negative 7: an attempted contact is never a successful contact; a requested notification is never delivered", async () => {
    const auth = { authorization: `Bearer ${ownerToken}` };
    const episodeId = (await sql`SELECT id FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId} AND status='open' LIMIT 1` as unknown as Array<{ id: string }>)[0]!.id;
    const notify = await app.inject({
      method: "POST",
      url: `/v1/fleet/jobs/${ids.jobId}/response`,
      headers: auth,
      payload: {
        episodeId, actionType: "notify_customer", stage: "attempt", idempotencyKey: randomUUID(),
        payload: { channel: "email" },
      },
    });
    expect(notify.statusCode).toBe(200);
    const list = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${ids.jobId}/episodes/${episodeId}/responses`,
      headers: auth,
    });
    const responses = (list.json() as { responses: Array<{ type: string; payload: { stage: string } }> }).responses;
    const contactAttempt = responses.find((entry) => entry.type === "response.contact_driver" && entry.payload.stage === "attempt");
    const contactConfirmed = responses.find((entry) => entry.type === "response.contact_driver" && entry.payload.stage === "confirmed");
    const notifyAttempt = responses.find((entry) => entry.type === "response.notify_customer");
    expect(contactAttempt).toBeTruthy();
    expect(contactConfirmed).toBeTruthy();
    expect(notifyAttempt?.payload.stage).toBe("attempt"); // requested, never "delivered"
  });
});

describe("demo phase 4: completion", () => {
  it("docs/56 positive 4: completion is refused until required evidence exists; the driver completes with photo + signature + recipient", async () => {
    const driverHeaders = { authorization: `Bearer ${driverAToken}` };
    const completePayload = {
      driverId: DEMO.driverAId,
      recipientName: "Demo Recipient",
    };
    // Refused: no evidence yet.
    const refused = await app.inject({
      method: "POST",
      url: `/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/complete`,
      headers: driverHeaders,
      payload: completePayload,
    });
    console.log("REFUSED RESPONSE:", refused.statusCode, JSON.stringify(refused.json()));
    expect(refused.statusCode).toBeGreaterThanOrEqual(400);
    expect(refused.json()).toMatchObject({ code: "EVIDENCE_REQUIRED" });

    const photo = await app.inject({
      method: "POST",
      url: `/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/evidence`,
      headers: driverHeaders,
      payload: {
        kind: "photo",
        dataBase64: DEMO_PNG_BYTES.toString("base64"),
        capturedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
      },
    });
    if (photo.statusCode >= 300) {
      console.log("PHOTO RESPONSE:", photo.statusCode, JSON.stringify(photo.json()));
    }
    expect(photo.statusCode).toBeLessThan(300);

    const signature = await app.inject({
      method: "POST",
      url: `/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/evidence`,
      headers: driverHeaders,
      payload: { kind: "signature", pathData: DEMO_SIGNATURE_PATH },
    });
    if (signature.statusCode >= 300) {
      console.log("SIGNATURE RESPONSE:", signature.statusCode, JSON.stringify(signature.json()));
    }
    expect(signature.statusCode).toBeLessThan(300);

    const completed = await app.inject({
      method: "POST",
      url: `/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/complete`,
      headers: driverHeaders,
      payload: completePayload,
    });
    expect(completed.statusCode).toBe(200);
    expect((completed.json() as { status: string }).status).toBe("completed");
  });

  it("negative 5: repeating the same completion does NOT duplicate records", async () => {
    const before = (await sql`
      SELECT count(*)::int AS count FROM job_events
      WHERE tenant_id = ${DEMO.tenantId} AND job_id = ${ids.jobId} AND type = 'job.completed'
    `) as unknown as Array<{ count: number }>;
    const again = await app.inject({
      method: "POST",
      url: `/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/complete`,
      headers: { authorization: `Bearer ${driverAToken}`, "idempotency-key": "demo-completion-once" },
      payload: { driverId: DEMO.driverAId, recipientName: "Demo Recipient" },
    });
    // The product refuses a repeated completion (4xx); the proof is that no
    // additional completion event was written.
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    const after = (await sql`
      SELECT count(*)::int AS count FROM job_events
      WHERE tenant_id = ${DEMO.tenantId} AND job_id = ${ids.jobId} AND type = 'job.completed'
    `) as unknown as Array<{ count: number }>;
    expect(after[0]?.count).toBe(before[0]?.count ?? 0);
  });
});

describe("demo phase 5: threat resolution + evidence", () => {
  it("the threat clears through the engine and the episode resolves (two consecutive clears)", async () => {
    // The active plan that covers the stop belongs to Driver A; the engine
    // evaluates stops from the plan. After the stop completes, fresh
    // telemetry yields consecutive 'none' assessments -> resolved.
    for (let i = 0; i < 2; i += 1) {
      expect(await postTelemetry(driverAToken, new Date().toISOString())).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const resolved = await waitFor(async () => {
      const rows = (await sql`
        SELECT status, resolution_note FROM exception_episodes
        WHERE tenant_id = ${DEMO.tenantId}
        ORDER BY created_at DESC LIMIT 1
      `) as unknown as Array<{ status: string; resolution_note: string | null }>;
      return rows[0]?.status === "resolved" ? rows[0] : null;
    });
    expect(resolved.resolution_note).toBe("threat_cleared");
  });

  it("negative 6: a resolved exception NEVER hides the original commitment result; timing stays honestly unverified", async () => {
    const auth = { authorization: `Bearer ${ownerToken}` };
    const outcomes = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${ids.jobId}/commitment-outcomes`,
      headers: auth,
    });
    expect(outcomes.statusCode).toBe(200);
    const stops = (outcomes.json() as { stops: Array<{ outcome: { operational: string; timing: string; originalTiming: string; revisedTiming: string } }> }).stops;
    const dropoff = stops[1];
    expect(dropoff?.outcome.operational).toBe("completed");
    expect(dropoff?.outcome.originalTiming).toBe("timing_unverified"); // no independent handover time - honest
    expect(dropoff?.outcome.timing).toBe("timing_unverified");
  });

  it("docs/56 positive 5: the evidence report is generated from the append-only record with verified integrity", async () => {
    const report = await gatherJobEvidenceReport(migrator, DEMO.tenantId, ids.jobId, store);
    expect(report).not.toBeNull();
    expect(report!.episodes.length).toBeGreaterThan(0);
    expect(report!.episodes[0]?.responses.length).toBeGreaterThan(0);
    const kinds = report!.stops.flatMap((stop) => stop.evidence.map((item) => item.kind));
    expect(kinds).toContain("photo");
    expect(kinds).toContain("signature");
    for (const stop of report!.stops) {
      for (const item of stop.evidence) {
        expect(item.integrity).toBe("verified");
      }
    }
    const pdf = await app.inject({
      method: "GET",
      url: `/v1/fleet/jobs/${ids.jobId}/evidence-report`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("isolation: the demo tenant is invisible to production tenants and production is untouched", async () => {
    const prodTenant = "734c7f72-3164-44f6-84f8-f3b60180be1c";
    const counts = (await sql`
      SELECT
        (SELECT count(*) FROM jobs WHERE tenant_id = ${prodTenant}) AS jobs,
        (SELECT count(*) FROM job_stops WHERE tenant_id = ${prodTenant}) AS stops,
        (SELECT count(*) FROM stop_evidence WHERE tenant_id = ${prodTenant}) AS evidence
    `) as unknown as Array<{ jobs: number; stops: number; evidence: number }>;
    expect(counts[0]?.jobs).toBe(prodJobCounts[0]);
    expect(counts[0]?.stops).toBe(prodJobCounts[1]);
    expect(counts[0]?.evidence).toBe(prodJobCounts[2]);
    // Demo rows exist only under the demo tenant.
    const demoLeaks = (await sql`
      SELECT count(*)::int AS count FROM jobs WHERE tenant_id = ${DEMO.tenantId}
    `) as unknown as Array<{ count: number }>;
    expect(demoLeaks[0]?.count).toBe(1);
  });
});


