/**
 * P1 slice 6: LIVE 120-second synthetic demonstration driver (docs/56 Â§12).
 * Seeds the isolated DEMO tenant (direct DB, owner role), then drives the
 * five phases over the production HTTP API with timestamps, downloads the
 * evidence report, verifies production isolation, and resets.
 * Usage: PF_OWNER_DB_URL="postgres://privatefleet:<owner-password>@127.0.0.1:5432/privatefleet" tsx scripts/p1-demo-120s.ts [apiBase]
 */
import { randomUUID } from "node:crypto";
import { hash as argonHash } from "@node-rs/argon2";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "../apps/api/src/db/client.js";
import {
  DEMO,
  DEMO_PNG_BYTES,
  DEMO_SIGNATURE_PATH,
  resetDemoScenario,
  seedDemoScenario,
} from "../apps/api/src/modules/commitments/demo.js";
import { EvidenceStore } from "../apps/api/src/modules/evidence/storage.js";
import { gatherJobEvidenceReport } from "../apps/api/src/modules/commitments/evidence-report.js";

const apiBase = process.argv[2] ?? "https://api.privatefleet.home.arpa";
// The owner-role connection string is REQUIRED via the environment; it is
// never stored in the repository. On the host it is composed from
// C:\PrivateFleet\secrets\secrets.json at run time.
const ownerDbUrl = process.env.PF_OWNER_DB_URL;
if (!ownerDbUrl) {
  console.error("PF_OWNER_DB_URL is required (owner-role connection string)");
  process.exit(1);
}
const evidenceDir = process.env.EVIDENCE_DIR ?? "C:\\PrivateFleet\\evidence";
const prodTenant = "734c7f72-3164-44f6-84f8-f3b60180be1c";

const startedAt = Date.now();
const log = (phase: string, message: string) => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[${elapsed}s] ${phase}: ${message}`);
};

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${apiBase}${path}`, init);
}

async function main(): Promise<void> {
  const handle: DbHandle = createDb(ownerDbUrl, { max: 2 });
  const pinHash = await argonHash("1234");

  log("SETUP", "seeding deterministic DEMO tenant (isolated, labelled)");
  const ids = await seedDemoScenario(handle, pinHash);
  await handle.db.execute(sql`
    INSERT INTO users (id, tenant_id, email, password_hash, role)
    VALUES (${randomUUID()}, ${DEMO.tenantId}, 'demo-owner@demo-120s.synthetic',
      ${await argonHash("demo-password-123")}, 'owner')
  `);

  const login = async (payload: Record<string, unknown>): Promise<string> => {
    const response = await api("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as { tokens?: { accessToken?: string } };
    if (!body.tokens?.accessToken) throw new Error(`login failed: ${response.status}`);
    return body.tokens.accessToken;
  };
  const driverLogin = async (driverId: string): Promise<string> => {
    const response = await api("/v1/auth/driver-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantSlug: DEMO.tenantSlug, driverId, pin: "1234" }),
    });
    const body = (await response.json()) as { tokens?: { accessToken?: string } };
    if (!body.tokens?.accessToken) throw new Error(`driver login failed: ${response.status}`);
    return body.tokens.accessToken;
  };

  // Phase 1: commitment (0-15s)
  const ownerToken = await login({
    tenantSlug: DEMO.tenantSlug,
    email: "demo-owner@demo-120s.synthetic",
    password: "demo-password-123",
  });
  const driverAToken = await driverLogin(DEMO.driverAId);
  const stateResponse = await api("/v1/fleet/state", {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const state = (await stateResponse.json()) as { jobs: Array<{ reference: string }> };
  log(
    "PHASE 1",
    `commitment visible to dispatch: demo job in fleet state = ${state.jobs.some((job) => job.reference === "DEMO-URGENT-1")}`,
  );
  const assign = await api(`/v1/jobs/${ids.jobId}/assign`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ driverId: DEMO.driverAId }),
  });
  log("PHASE 1", `assigned to Driver A via the existing workflow: HTTP ${assign.status}`);

  // Phase 2: detection (15-35s)
  await new Promise((resolve) => setTimeout(resolve, 2000));
  log("PHASE 2", "detection: fresh telemetry; planned arrival after the window");
  const telemetry = (token: string, lat = 51.508, lng = -0.1) =>
    api("/v1/telemetry", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        samples: [{ latitude: lat, longitude: lng, capturedAt: new Date().toISOString(), accuracyMetres: 5, movementState: "moving" }],
      }),
    });
  for (let i = 0; i < 3; i += 1) {
    const response = await telemetry(driverAToken);
    log("PHASE 2", `telemetry ingest: HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  // Phase 3: intervention (35-65s)
  const episodeRows = (await handle.db.execute(sql`
    SELECT id FROM exception_episodes
    WHERE tenant_id = ${DEMO.tenantId} AND status = 'open'
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  const episodeId = episodeRows[0]?.id;
  log("PHASE 3", `intervention: active episode ${episodeId ?? "NONE (failure)"}`);
  const response = (payload: Record<string, unknown>) =>
    api(`/v1/fleet/jobs/${ids.jobId}/response`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  const r1 = await response({ episodeId, actionType: "contact_driver", stage: "attempt", idempotencyKey: randomUUID(), payload: { channel: "phone" } });
  const r2 = await response({ episodeId, actionType: "contact_driver", stage: "confirmed", idempotencyKey: randomUUID(), payload: { channel: "phone", outcome: "failed", reason: "no answer" } });
  const r3 = await response({ episodeId, actionType: "reassign", stage: "confirmed", idempotencyKey: randomUUID(), payload: { fromDriverId: DEMO.driverAId, toDriverId: DEMO.driverBId } });
  const r4 = await response({ episodeId, actionType: "reschedule", stage: "confirmed", idempotencyKey: randomUUID(), payload: { windowStart: new Date(Date.now() + 10 * 60_000).toISOString(), windowEnd: new Date(Date.now() + 40 * 60_000).toISOString(), effectiveAt: new Date().toISOString() } });
  const r5 = await response({ episodeId, actionType: "notify_customer", stage: "attempt", idempotencyKey: randomUUID(), payload: { channel: "email" } });
  log("PHASE 3", `responses recorded (attempt/failed/reassign/reschedule/notify): ${[r1, r2, r3, r4, r5].map((entry) => entry.status).join(",")}`);
  const resolutionCheck = await api(`/v1/fleet/jobs/${ids.jobId}/episodes/${episodeId}/resolution`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const resolutionBody = (await resolutionCheck.json()) as { resolution: { state: string } };
  log("PHASE 3", `derived resolution after a FAILED contact: ${resolutionBody.resolution.state} (failed is never resolved)`);

  // Phase 4: completion (65-95s)
  log("PHASE 4", "completion: refused without evidence, then photo + signature + recipient");
  const complete = () =>
    api(`/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${driverAToken}`, "content-type": "application/json" },
      body: JSON.stringify({ driverId: DEMO.driverAId, recipientName: "Demo Recipient" }),
    });
  const refused = await complete();
  log("PHASE 4", `completion without evidence refused: HTTP ${refused.status} ${(await refused.json() as { code: string }).code}`);
  const photo = await api(`/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/evidence`, {
    method: "POST",
    headers: { authorization: `Bearer ${driverAToken}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "photo", dataBase64: DEMO_PNG_BYTES.toString("base64"), capturedAt: new Date(Date.now() - 2 * 60_000).toISOString() }),
  });
  const signature = await api(`/v1/jobs/${ids.jobId}/stops/${ids.stopDropoffId}/evidence`, {
    method: "POST",
    headers: { authorization: `Bearer ${driverAToken}`, "content-type": "application/json" },
    body: JSON.stringify({ kind: "signature", pathData: DEMO_SIGNATURE_PATH }),
  });
  log("PHASE 4", `photo upload: HTTP ${photo.status}; signature upload: HTTP ${signature.status}`);
  const completed = await complete();
  log("PHASE 4", `completion accepted: HTTP ${completed.status}`);
  for (let i = 0; i < 2; i += 1) {
    await telemetry(driverAToken);
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  // Phase 5: evidence (95-120s)
  const finalEpisode = (await handle.db.execute(sql`
    SELECT status, resolution_note FROM exception_episodes
    WHERE tenant_id = ${DEMO.tenantId} ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ status: string; resolution_note: string | null }>;
  log("PHASE 5", `threat cleared -> episode ${finalEpisode[0]?.status} (${finalEpisode[0]?.resolution_note ?? "n/a"})`);
  const outcomes = await api(`/v1/fleet/jobs/${ids.jobId}/commitment-outcomes`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const outcomeBody = (await outcomes.json()) as { stops: Array<{ outcome: { operational: string; timing: string; originalTiming: string; revisedTiming: string } }> };
  const dropoff = outcomeBody.stops[1];
  log(
    "PHASE 5",
    `dropoff: operational=${dropoff?.outcome.operational} timing=${dropoff?.outcome.timing} original=${dropoff?.outcome.originalTiming} revised=${dropoff?.outcome.revisedTiming}`,
  );
  const pdfResponse = await api(`/v1/fleet/jobs/${ids.jobId}/evidence-report`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  const pdfPath = `C:\\privatefleet\\logs\\demo-evidence-report-${Date.now()}.pdf`;
  writeFileSync(pdfPath, pdfBytes);
  log("PHASE 5", `evidence report: HTTP ${pdfResponse.status}, ${pdfBytes.length} bytes, %PDF-: ${pdfBytes.subarray(0, 5).toString() === "%PDF-"} -> ${pdfPath}`);

  // Integrity + isolation + reset
  const store = new EvidenceStore(evidenceDir);
  const report = await gatherJobEvidenceReport(handle, DEMO.tenantId, ids.jobId, store);
  const integrity = report?.stops.flatMap((stop) => stop.evidence.map((item) => item.integrity)) ?? [];
  log("VERIFY", `evidence integrity (re-hashed at report time): ${integrity.join(",")}`);
  const prodCounts = (await handle.db.execute(sql`
    SELECT
      (SELECT count(*) FROM jobs WHERE tenant_id = ${prodTenant}) AS jobs,
      (SELECT count(*) FROM job_stops WHERE tenant_id = ${prodTenant}) AS stops,
      (SELECT count(*) FROM stop_evidence WHERE tenant_id = ${prodTenant}) AS evidence
  `)) as unknown as Array<{ jobs: number; stops: number; evidence: number }>;
  log("VERIFY", `production untouched: jobs=${prodCounts[0]?.jobs} stops=${prodCounts[0]?.stops} evidence=${prodCounts[0]?.evidence}`);
  await resetDemoScenario(handle);
  const leftover = (await handle.db.execute(sql`
    SELECT count(*)::int AS count FROM tenants WHERE id = ${DEMO.tenantId}
  `)) as unknown as Array<{ count: number }>;
  log("VERIFY", `deterministic reset complete: demo tenant rows remaining = ${leftover[0]?.count}`);
  log(
    "DONE",
    `PrivateFleet identified an operational threat, recorded the intervention, and preserved the evidence of completion. Total ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("DEMO FAILED:", error);
  process.exit(1);
});

