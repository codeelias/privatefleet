/**
 * P1 slice 5 (docs/56 section 10): printable per-job evidence report.
 * REUSES existing records only - no new evidence or recovery tables. Every
 * fact in the report is read from job/job_stops/stop_evidence/job_events/
 * exception_episodes/drivers plus real byte-level integrity verification of
 * the stored evidence files against their recorded content hashes.
 */
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";
import { EvidenceStore } from "../evidence/storage.js";
import { deriveCommitmentOutcome, deriveExceptionResolution, type DerivedCommitmentOutcome, type DerivedResolution } from "./outcomes.js";
import { DEFAULT_HANDOVER_RADIUS_M, independentHandoverBracket } from "./handover.js";
import type { ResponseEventRow } from "./response-actions.js";

export type IntegrityStatus = "verified" | "mismatch" | "missing";

export interface EvidenceReportItem {
  kind: string;
  mimeType: string;
  byteSize: number;
  capturedAt: string | null;
  serverReceivedAt: string;
  contentHash: string;
  integrity: IntegrityStatus;
}

export interface ReportStop {
  sequence: number;
  address: string;
  stopType: string;
  status: string;
  windowStart: string;
  windowEnd: string;
  outcome: DerivedCommitmentOutcome;
  evidence: EvidenceReportItem[];
}

export interface JobEvidenceReport {
  jobReference: string;
  serviceType: string;
  jobStatus: string;
  driverName: string | null;
  stops: ReportStop[];
  episodes: Array<{
    id: string;
    status: string;
    threatClass: string;
    level: string;
    openedAt: string;
    resolution: DerivedResolution;
    responses: ResponseEventRow[];
  }>;
  generatedAt: string;
}

/** Byte-level integrity verification against the recorded content hash. */
export async function verifyEvidenceIntegrity(
  store: EvidenceStore,
  storageKey: string,
  contentHash: string,
): Promise<IntegrityStatus> {
  try {
    const bytes = await store.read(storageKey);
    const actual = createHash("sha256").update(bytes).digest("hex");
    return actual === contentHash ? "verified" : "mismatch";
  } catch {
    return "missing";
  }
}

export async function gatherJobEvidenceReport(
  handle: DbHandle,
  tenantId: string,
  jobId: string,
  store: EvidenceStore,
): Promise<JobEvidenceReport | null> {
  return withTenant(handle, tenantId, async (db) => {
    const jobs = (await db.execute(sql`
      SELECT j.id, j.reference, j.service_type, j.status, j.assigned_vehicle_id,
             COALESCE(d.full_name, '') AS driver_name
      FROM jobs j
      LEFT JOIN drivers d ON d.id = j.assigned_driver_id AND d.tenant_id = j.tenant_id
      WHERE j.tenant_id = ${tenantId} AND j.id = ${jobId}
    `)) as unknown as Array<{
      id: string;
      reference: string;
      service_type: string;
      status: string;
      assigned_vehicle_id: string | null;
      driver_name: string;
    }>;
    const job = jobs[0];
    if (!job) return null;

    const stops = (await db.execute(sql`
      SELECT s.id, s.sequence, s.stop_type, s.address, s.status, s.window_start, s.window_end, s.latitude, s.longitude
      FROM job_stops s
      WHERE s.tenant_id = ${tenantId} AND s.job_id = ${jobId}
      ORDER BY s.sequence
    `)) as unknown as Array<{
      id: string;
      sequence: number;
      stop_type: string;
      address: string;
      status: string;
      window_start: Date | string;
      window_end: Date | string;
      latitude: number;
      longitude: number;
    }>;
    const stopIds = stops.map((stop) => stop.id);

    const evidenceRows = stopIds.length === 0
      ? []
      : ((await db.execute(sql`
          SELECT stop_id, kind, mime_type, byte_size, captured_at, created_at, content_hash, storage_key
          FROM stop_evidence
          WHERE tenant_id = ${tenantId} AND stop_id IN ${stopIds}
          ORDER BY created_at ASC
        `)) as unknown as Array<{
          stop_id: string;
          kind: string;
          mime_type: string;
          byte_size: number;
          captured_at: Date | string | null;
          created_at: Date | string;
          content_hash: string;
          storage_key: string;
        }>);

    const policy = (await db.execute(sql`
      SELECT service_type, require_recipient, require_signature, require_photo, require_failure_photo, completion_radius_m
      FROM proof_policies
      WHERE tenant_id = ${tenantId} AND service_type IN (${job.service_type}, '*')
    `)) as unknown as Array<{
      service_type: string;
      require_recipient: boolean;
      require_signature: boolean;
      require_photo: boolean;
      require_failure_photo: boolean;
      completion_radius_m: number | null;
    }>;
    const chosenPolicy = policy.find((p) => p.service_type === job.service_type) ?? policy[0];
    const radiusM = chosenPolicy?.completion_radius_m ?? DEFAULT_HANDOVER_RADIUS_M;
    const requiredKinds = [
      ...(chosenPolicy?.require_recipient ? ["recipient"] : []),
      ...(chosenPolicy?.require_signature ? ["signature"] : []),
      ...(chosenPolicy?.require_photo ? ["photo"] : []),
      ...(chosenPolicy?.require_failure_photo ? ["failure_photo"] : []),
    ];

    const revisions = (await db.execute(sql`
      SELECT e.stop_id, jv.payload
      FROM job_events jv
      JOIN exception_episodes e ON e.id = jv.episode_id
      WHERE jv.tenant_id = ${tenantId} AND jv.type = 'response.reschedule'
        AND jv.payload->>'stage' = 'confirmed'
    `)) as unknown as Array<{ stop_id: string; payload: unknown }>;

    const reportStops: ReportStop[] = [];
    for (const stop of stops) {
      const stopEvidence = evidenceRows.filter((row) => row.stop_id === stop.id);
      const receiptTime = stopEvidence
        .map((row) => new Date(row.created_at).getTime())
        .reduce<number | null>((max, t) => (max === null || t > max ? t : max), null);
      // Independent handover evidence ONLY (server-clock presence fix +
      // server-clock evidence receipt); the device clock is never trusted.
      const handoverBracket = await independentHandoverBracket(
        db,
        tenantId,
        { latitude: stop.latitude, longitude: stop.longitude },
        job.assigned_vehicle_id,
        radiusM,
        receiptTime === null ? null : new Date(receiptTime),
      );
      const stopRevisions = revisions
        .filter((revision) => revision.stop_id === stop.id)
        .map((revision) => {
          const payload = revision.payload as { windowStart?: string; windowEnd?: string; effectiveAt?: string | null };
          return {
            windowStart: payload.windowStart ?? "",
            windowEnd: payload.windowEnd ?? "",
            effectiveAt: payload.effectiveAt ?? null,
          };
        })
        .filter((revision) => revision.windowStart && revision.windowEnd);
      const evidence: EvidenceReportItem[] = [];
      for (const row of stopEvidence) {
        evidence.push({
          kind: row.kind,
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          capturedAt: row.captured_at == null ? null : new Date(row.captured_at).toISOString(),
          serverReceivedAt: new Date(row.created_at).toISOString(),
          contentHash: row.content_hash,
          integrity: await verifyEvidenceIntegrity(store, row.storage_key, row.content_hash),
        });
      }
      reportStops.push({
        sequence: stop.sequence,
        address: stop.address,
        stopType: stop.stop_type,
        status: stop.status,
        windowStart: new Date(stop.window_start).toISOString(),
        windowEnd: new Date(stop.window_end).toISOString(),
        outcome: deriveCommitmentOutcome({
          status: stop.status,
          jobCancelled: job.status === "cancelled",
          handoverBracket,
          windowStart: new Date(stop.window_start).toISOString(),
          windowEnd: new Date(stop.window_end).toISOString(),
          evidenceKinds: stopEvidence.map((row) => row.kind),
          requiredEvidenceKinds: requiredKinds,
          revisions: stopRevisions,
        }),
        evidence,
      });
    }

    const episodes = (await db.execute(sql`
      SELECT id, status, threat_class, level, created_at, stop_id
      FROM exception_episodes
      WHERE tenant_id = ${tenantId} AND job_id = ${jobId}
      ORDER BY created_at ASC
    `)) as unknown as Array<{
      id: string;
      status: string;
      threat_class: string;
      level: string;
      created_at: Date | string;
      stop_id: string;
    }>;

    const reportEpisodes = [];
    for (const episode of episodes) {
      const responses = (await db.execute(sql`
        SELECT id, episode_id, type, actor_id, payload, created_at
        FROM job_events
        WHERE tenant_id = ${tenantId} AND episode_id = ${episode.id} AND type LIKE 'response.%'
        ORDER BY created_at ASC
      `)) as unknown as Array<{
        id: string;
        episode_id: string | null;
        type: string;
        actor_id: string | null;
        payload: unknown;
        created_at: Date | string;
      }>;
      const responseRows: ResponseEventRow[] = responses.map((row) => ({
        id: row.id,
        episodeId: row.episode_id,
        type: row.type,
        actorId: row.actor_id,
        payload: row.payload,
        occurredAt: new Date(row.created_at).toISOString(),
      }));
      reportEpisodes.push({
        id: episode.id,
        status: episode.status,
        threatClass: episode.threat_class,
        level: episode.level,
        openedAt: new Date(episode.created_at).toISOString(),
        resolution: deriveExceptionResolution(episode, responseRows),
        responses: responseRows,
      });
    }

    return {
      jobReference: job.reference,
      serviceType: job.service_type,
      jobStatus: job.status,
      driverName: job.driver_name || null,
      stops: reportStops,
      episodes: reportEpisodes,
      generatedAt: new Date().toISOString(),
    };
  });
}

/** Render the report as a PDF (pdfkit, no external services). */
export async function buildEvidenceReportPdf(report: JobEvidenceReport): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 48, right: 48 } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", resolve));

  doc.fontSize(18).text("PrivateFleet - Evidence Report", { align: "left" });
  doc.fontSize(10)
    .text(`Job ${report.jobReference}  |  ${report.serviceType}  |  status: ${report.jobStatus}`)
    .text(`Driver: ${report.driverName ?? "unassigned"}  |  Generated: ${report.generatedAt}`)
    .moveDown();

  for (const stop of report.stops) {
    doc.fontSize(12).text(`Stop ${stop.sequence} - ${stop.stopType.toUpperCase()} - ${stop.address}`, { underline: true });
    doc.fontSize(10)
      .text(`Status: ${stop.status}   Window: ${stop.windowStart} to ${stop.windowEnd}`)
      .text(`Outcome: operational=${stop.outcome.operational}  timing=${stop.outcome.timing}  ` +
        `evidence=${stop.outcome.evidenceCompleteness}  original=${stop.outcome.originalTiming}  ` +
        `revised=${stop.outcome.revisedTiming}`);
    for (const item of stop.evidence) {
      doc.text(`  [${item.kind}] captured=${item.capturedAt ?? "n/a"}  server-receipt=${item.serverReceivedAt}  ` +
        `${item.byteSize} bytes  sha256=${item.contentHash.slice(0, 16)}...  integrity=${item.integrity}`);
    }
    if (stop.evidence.length === 0) {
      doc.text("  (no evidence recorded)");
    }
    doc.moveDown(0.5);
  }

  if (report.episodes.length > 0) {
    doc.fontSize(12).text("Exception and response history", { underline: true });
    for (const episode of report.episodes) {
      doc.fontSize(10)
        .text(`Episode ${episode.id.slice(0, 8)}  ${episode.threatClass} (${episode.level})  status=${episode.status}  ` +
          `derived=${episode.resolution.state}  opened=${episode.openedAt}`);
      for (const response of episode.responses) {
        const payload = response.payload as { stage?: string; outcome?: string };
        doc.text(`    ${response.type}  stage=${payload.stage ?? "n/a"}  outcome=${payload.outcome ?? "n/a"}  ` +
          `at=${response.occurredAt}  actor=${response.actorId ?? "n/a"}`);
      }
    }
    doc.moveDown(0.5);
  } else {
    doc.fontSize(10).text("Exception and response history: none recorded for this job.").moveDown(0.5);
  }

  doc.fontSize(8)
    .fillColor("#555555")
    .text("Integrity: every evidence file above was re-hashed at report time and compared with the recorded " +
      "content hash. 'verified' means the stored file matches its record; 'mismatch' and 'missing' must be " +
      "investigated. Timing classes require corroborated time evidence (device capture + server receipt); " +
      "otherwise timing_unverified is reported.");
  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
