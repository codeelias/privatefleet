/**
 * Exception episode service (docs/56 section 8): turns a threat assessment
 * into ONE active episode per (scope + threat class), refreshes episode
 * context on repeated observation, and closes with an explicitly recorded
 * reason only when the threat demonstrably clears (consecutive clears - a
 * single transient observation can never close an episode).
 *
 * Alerts remain a presentation projection (later slice); the episode owns
 * the operational lifecycle.
 */
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";
import {
  assessCommitmentRisk,
  type CommitmentRiskInput,
  type RiskAssessment,
} from "./commitment-risk.js";

export const CLEARS_TO_CLOSE = 2;

export type EpisodeStatus =
  | "open"
  | "investigating"
  | "response_in_progress"
  | "resolved"
  | "closed";

export interface EpisodeRow {
  id: string;
  jobId: string;
  stopId: string;
  threatClass: string;
  level: string;
  fingerprint: string;
  reasons: string[];
  planVersion: number | null;
  status: EpisodeStatus;
  createdAt: string;
}

interface DbRow {
  id: string;
  job_id: string;
  stop_id: string;
  threat_class: string;
  level: string;
  fingerprint: string;
  reasons: unknown;
  plan_version: number | null;
  status: EpisodeStatus;
  created_at: Date | string;
}

function toRow(row: DbRow): EpisodeRow {
  return {
    id: row.id,
    jobId: row.job_id,
    stopId: row.stop_id,
    threatClass: row.threat_class,
    level: row.level,
    fingerprint: row.fingerprint,
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    planVersion: row.plan_version,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const ACTIVE = sql`status IN ('open','investigating','response_in_progress')`;

/**
 * Apply one assessment. Idempotent by construction: the partial unique index
 * admits one active episode per fingerprint. Threat observations refresh the
 * LATEST context (reasons, plan provenance) without touching the OPENING
 * evidence (opened_reasons, opened_plan_version). A demonstrably cleared
 * threat (consecutive clears) is RESOLVED with the recorded resolution note
 * 'threat_cleared' - docs/56: resolved = threat addressed, supported by
 * evidence; closed is reserved for duplicate/invalidated/superseded.
 */
export async function applyAssessment(
  handle: DbHandle,
  tenantId: string,
  jobId: string,
  scopeId: string,
  assessment: RiskAssessment,
  planVersion: number | null,
): Promise<EpisodeRow | null> {
  return withTenant(handle, tenantId, async (db) => {
    if (assessment.kind === "threat") {
      await db.execute(sql`
        INSERT INTO exception_episodes
          (tenant_id, job_id, stop_id, threat_class, level, fingerprint, reasons, plan_version,
           opened_reasons, opened_plan_version, status)
        VALUES
          (${tenantId}, ${jobId}, ${assessment.scopeId}, ${assessment.threatClass},
           ${assessment.level}, ${assessment.fingerprint}, ${JSON.stringify(assessment.reasons)}::jsonb,
           ${planVersion},
           ${JSON.stringify(assessment.reasons)}::jsonb, ${planVersion}, 'open')
        ON CONFLICT (tenant_id, fingerprint) WHERE status IN ('open','investigating','response_in_progress')
        DO NOTHING
      `);
      await db.execute(sql`
        UPDATE exception_episodes
        SET reasons = ${JSON.stringify(assessment.reasons)}::jsonb,
            plan_version = COALESCE(${planVersion}, plan_version),
            clear_count = 0
        WHERE tenant_id = ${tenantId} AND fingerprint = ${assessment.fingerprint}
          AND ${ACTIVE}
      `);
      const rows = (await db.execute(sql`
        SELECT * FROM exception_episodes
        WHERE tenant_id = ${tenantId} AND fingerprint = ${assessment.fingerprint}
          AND ${ACTIVE}
        ORDER BY created_at DESC LIMIT 1
      `)) as unknown as DbRow[];
      return rows[0] ? toRow(rows[0]) : null;
    }

    // No threat: every open episode for this stop moves one step closer to a
    // recorded RESOLUTION. Consecutive clears are required, so a single
    // transient observation can never resolve an episode.
    const incremented = (await db.execute(sql`
      UPDATE exception_episodes
      SET clear_count = clear_count + 1
      WHERE tenant_id = ${tenantId} AND stop_id = ${scopeId} AND status = 'open'
      RETURNING id, clear_count
    `)) as unknown as Array<{ id: string; clear_count: number }>;
    for (const row of incremented) {
      if (Number(row.clear_count) >= CLEARS_TO_CLOSE) {
        await db.execute(sql`
          UPDATE exception_episodes
          SET status = 'resolved', resolved_at = now(), resolution_note = 'threat_cleared'
          WHERE id = ${row.id} AND status = 'open'
        `);
      }
    }
    return null;
  });
}

/**
 * Evaluate one stop with the pure engine and apply the result.
 */
export async function evaluateStop(
  handle: DbHandle,
  tenantId: string,
  jobId: string,
  input: CommitmentRiskInput,
  planVersion: number | null,
): Promise<EpisodeRow | null> {
  const assessment = assessCommitmentRisk(input);
  return applyAssessment(handle, tenantId, jobId, input.stopId, assessment, planVersion);
}

/** Active episodes for a job (dispatcher/response-flow surface, later slice). */
export async function activeEpisodes(
  handle: DbHandle,
  tenantId: string,
  jobId: string,
): Promise<EpisodeRow[]> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      SELECT * FROM exception_episodes
      WHERE tenant_id = ${tenantId} AND job_id = ${jobId}
        AND ${ACTIVE}
      ORDER BY created_at DESC
    `)) as unknown as DbRow[];
    return rows.map(toRow);
  });
}

export type CloseReason = "duplicate" | "invalidated" | "superseded";

/**
 * Close an ACTIVE episode with an explicitly recorded non-recovery reason
 * (docs/56: closed = duplicate / invalidated / superseded). Closing NEVER
 * implies recovery - a resolved episode has resolution_note set; a closed
 * episode never does.
 */
export async function closeEpisode(
  handle: DbHandle,
  tenantId: string,
  episodeId: string,
  reason: CloseReason,
): Promise<boolean> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      UPDATE exception_episodes
      SET status = 'closed', closed_at = now(), close_reason = ${reason}
      WHERE tenant_id = ${tenantId} AND id = ${episodeId} AND ${ACTIVE}
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    return rows.length > 0;
  });
}

export interface CommitmentLogger {
  warn(msg: string, extra?: unknown): void;
}

/**
 * Evaluate the driver's open stops against their live fix (docs/56: risk over
 * LIVE data only). Loads everything in one read transaction, then applies
 * each assessment in its own transaction - never nested, never blocking.
 * Failures never propagate to telemetry, but they are ALWAYS logged through
 * the supplied logger (background failures must never disappear silently).
 */
export async function evaluateDriverCommitments(
  handle: DbHandle,
  tenantId: string,
  driverId: string,
  logger?: CommitmentLogger,
): Promise<void> {
  const context = await withTenant(handle, tenantId, async (db) => {
    const fixRows = (await db.execute(sql`
      WITH last_move AS (
        SELECT MAX(captured_at) AS at FROM location_points
        WHERE vehicle_id = (SELECT id FROM vehicles WHERE driver_id = ${driverId} LIMIT 1)
          AND movement_state IS DISTINCT FROM 'stationary'
      ),
      latest AS (
        SELECT movement_state, captured_at, accuracy_metres
        FROM location_points
        WHERE vehicle_id = (SELECT id FROM vehicles WHERE driver_id = ${driverId} LIMIT 1)
        ORDER BY captured_at DESC LIMIT 1
      )
      SELECT v.captured_at AS fix_at,
             latest.movement_state, latest.captured_at AS last_fix_at,
             latest.accuracy_metres, last_move.at AS last_move_at
      FROM vehicles v, latest, last_move
      WHERE v.driver_id = ${driverId}
      LIMIT 1
    `)) as unknown as Array<{
      fix_at: Date | string | null;
      movement_state: string | null;
      last_fix_at: Date | string | null;
      accuracy_metres: number | null;
      last_move_at: Date | string | null;
    }>;
    const fix = fixRows[0];

    const stopRows = (await db.execute(sql`
      SELECT s.id AS stop_id, s.job_id, s.status, s.window_start, s.window_end,
             plan.planned_arrival_at, plan.version
      FROM job_stops s
      JOIN jobs j ON j.id = s.job_id
      LEFT JOIN LATERAL (
        SELECT rs.planned_arrival_at, r.version
        FROM route_stops rs
        JOIN routes r ON r.id = rs.route_id
        WHERE rs.job_stop_id = s.id
          AND r.driver_id = ${driverId}
          AND r.status IN ('published', 'in_progress')
        ORDER BY r.version DESC
        LIMIT 1
      ) plan ON true
      WHERE j.assigned_driver_id = ${driverId}
        AND s.status IN ('pending', 'arrived', 'completed', 'skipped', 'failed')
    `)) as unknown as Array<{
      stop_id: string;
      job_id: string;
      status: string;
      window_start: Date | string | null;
      window_end: Date | string | null;
      planned_arrival_at: Date | string | null;
      version: number | null;
    }>;
    return { fix, stops: stopRows };
  });

  const fix = context.fix;
  if (!fix?.fix_at) return; // no fix: never score (stale GPS is not live GPS)

  const stationarySinceMs =
    fix.movement_state === "stationary" && fix.last_move_at
      ? Math.max(0, Date.now() - new Date(fix.last_move_at).getTime())
      : 0;

  for (const stop of context.stops) {
    try {
      await evaluateStop(handle, tenantId, stop.job_id, {
        nowMs: Date.now(),
        stopId: stop.stop_id,
        stopStatus: stop.status,
        windowStart: stop.window_start,
        windowEnd: stop.window_end,
        plannedArrivalAt: stop.planned_arrival_at,
        fixCapturedAt: fix.fix_at,
        fixAccuracyMetres: fix.accuracy_metres,
        stationarySinceMs,
      }, stop.version);
    } catch (error) {
      // Best-effort: episode evaluation must never disturb telemetry ingest -
      // but the failure must remain observable.
      logger?.warn("commitment evaluation failed for a stop", {
        driverId,
        stopId: stop.stop_id,
        error,
      });
    }
  }
}
