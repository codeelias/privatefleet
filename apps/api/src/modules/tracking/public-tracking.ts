/**
 * Job-scoped public tracking (Stage 4, commit 4). Only the SHA-256 of a
 * high-entropy token is stored. The public endpoint derives tenancy from the
 * token itself and exposes a strictly scoped read-only view: job progress,
 * ETA, permitted vehicle position and driver/vehicle names. No phone, email
 * or other personal data is included.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PublicTrackingResponse } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";
import { computeLiveProgress } from "./route-progress.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createTrackingToken(
  handle: DbHandle,
  tenantId: string,
  jobId: string,
): Promise<{ id: string; token: string; expiresAt: string }> {
  return withTenant(handle, tenantId, async (db) => {
    const jobs = (await db.execute(
      sql`SELECT 1 FROM jobs WHERE id = ${jobId}`,
    )) as unknown as Array<unknown>;
    if (jobs.length === 0) {
      throw new Error("JOB_NOT_FOUND");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    const id = randomUUID();
    await db.execute(sql`
      INSERT INTO tracking_tokens (id, tenant_id, job_id, token_hash, expires_at)
      VALUES (${id}, ${tenantId}, ${jobId}, ${hashToken(token)}, ${expiresAt.toISOString()})
    `);
    return { id, token, expiresAt: expiresAt.toISOString() };
  });
}

export async function revokeTrackingToken(
  handle: DbHandle,
  tenantId: string,
  tokenId: string,
): Promise<boolean> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      UPDATE tracking_tokens SET revoked_at = now()
      WHERE id = ${tokenId} AND revoked_at IS NULL
      RETURNING id
    `)) as unknown as Array<unknown>;
    return rows.length > 0;
  });
}

export async function publicTracking(
  handle: DbHandle,
  token: string,
): Promise<PublicTrackingResponse | null> {
  const tokenRow = (await handle.sql`
    SELECT tenant_id, job_id, expires_at, revoked_at
    FROM public_tracking_token_by_hash(${hashToken(token)})
  `) as unknown as Array<{
    tenant_id: string;
    job_id: string;
    expires_at: Date | string;
    revoked_at: Date | string | null;
  }>;
  const row = tokenRow[0];
  if (!row) return null;
  const expires = new Date(row.expires_at).getTime();
  if (row.revoked_at !== null || Date.now() > expires) return null;

  return withTenant(handle, row.tenant_id, async (db) => {
    const jobs = (await db.execute(sql`
      SELECT j.reference, j.status, j.assigned_vehicle_id, j.assigned_driver_id,
             v.registration, v.latitude, v.longitude, v.captured_at, d.full_name
      FROM jobs j
      LEFT JOIN vehicles v ON v.id = j.assigned_vehicle_id
      LEFT JOIN drivers d ON d.id = j.assigned_driver_id
      WHERE j.id = ${row.job_id}
    `)) as unknown as Array<{
      reference: string;
      status: string;
      assigned_vehicle_id: string | null;
      assigned_driver_id: string | null;
      registration: string | null;
      latitude: number | null;
      longitude: number | null;
      captured_at: Date | string | null;
      full_name: string | null;
    }>;
    const job = jobs[0];
    if (!job) return null;

    const stops = (await db.execute(sql`
      SELECT sequence, address, status, arrived_at, completed_at
      FROM job_stops WHERE job_id = ${row.job_id}
      ORDER BY sequence ASC
    `)) as unknown as Array<{
      sequence: number;
      address: string;
      status: string;
      arrived_at: Date | string | null;
      completed_at: Date | string | null;
    }>;

    const etaRows = (await db.execute(sql`
      SELECT MIN(rs.planned_arrival_at) AS eta,
             MIN(s.window_end) FILTER (WHERE s.stop_type = 'dropoff') AS window_end
      FROM route_stops rs
      JOIN job_stops s ON s.id = rs.job_stop_id
      WHERE s.job_id = ${row.job_id} AND s.status IN ('pending', 'arrived')
    `)) as unknown as Array<{ eta: Date | string | null; window_end: Date | string | null }>;

    const position =
      job.latitude !== null && job.longitude !== null && job.captured_at
        ? {
            latitude: job.latitude,
            longitude: job.longitude,
            capturedAt: new Date(job.captured_at).toISOString(),
            stale: Date.now() - new Date(job.captured_at).getTime() > STALE_AFTER_MS,
          }
        : undefined;

    const positionAgeMs = position
      ? Math.max(0, Date.now() - new Date(position.capturedAt).getTime())
      : null;
    const etaConfidence =
      positionAgeMs === null ? "low" : positionAgeMs <= 15_000 ? "high" : positionAgeMs <= 45_000 ? "medium" : "low";
    const etaValue = etaRows[0]?.eta ? new Date(etaRows[0]!.eta!).getTime() : null;
    const windowEndValue = etaRows[0]?.window_end
      ? new Date(etaRows[0]!.window_end!).getTime()
      : null;
    const delayStatus =
      etaValue === null || windowEndValue === null
        ? "unknown"
        : etaValue > windowEndValue
          ? "late"
          : "on_time";
    const remainingStops = stops.filter(
      (stop) => stop.status === "pending" || stop.status === "arrived",
    ).length;

    const evidenceRows = (await db.execute(sql`
      SELECT kind, max(captured_at) AS last_captured
      FROM stop_evidence
      WHERE job_id = ${row.job_id}
      GROUP BY kind
    `)) as unknown as Array<{ kind: string; last_captured: Date | string | null }>;
    const photos = evidenceRows.filter((entry) => entry.kind === "photo" || entry.kind === "failure_photo").length;
    const signatures = evidenceRows.filter((entry) => entry.kind === "signature").length;
    const lastRecorded = evidenceRows
      .map((entry) => (entry.last_captured ? new Date(entry.last_captured).getTime() : null))
      .filter((value): value is number => value !== null)
      .sort((a, b) => b - a)[0];
    const proof =
      photos > 0 || signatures > 0
        ? {
            photos,
            signatures,
            ...(lastRecorded ? { lastRecordedAt: new Date(lastRecorded).toISOString() } : {}),
          }
        : undefined;

    let inCustomerZone: boolean | undefined;
    let customerZoneName: string | undefined;
    if (position) {
      const zoneRows = (await db.execute(sql`
        SELECT name FROM geofences
        WHERE tenant_id = ${row.tenant_id}
          AND enabled = true
          AND job_id = ${row.job_id}
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${position.longitude}, ${position.latitude}), 4326))
        LIMIT 1
      `)) as unknown as Array<{ name: string }>;
      if (zoneRows[0]) {
        inCustomerZone = true;
        customerZoneName = zoneRows[0].name;
      }
    }

    // Live route-aware progress: project the vehicle onto the published
    // route and count incomplete stops before this job's first stop.
    let liveProgress: { stopsAway: number; etaMinutes: number } | undefined;
    if (position && !position.stale && job.assigned_driver_id) {
      const routeRows = (await db.execute(sql`
        SELECT geometry FROM routes
        WHERE tenant_id = ${row.tenant_id}
          AND driver_id = ${job.assigned_driver_id}
          AND status IN ('published', 'in_progress')
        ORDER BY version DESC
        LIMIT 1
      `)) as unknown as Array<{
        geometry: Array<{ latitude: number; longitude: number }> | null;
      }>;
      const geometry = routeRows[0]?.geometry;
      if (geometry && geometry.length >= 2) {
        const sequenceRows = (await db.execute(sql`
          SELECT rs.sequence_no, s.id AS stop_id, s.job_id, s.latitude, s.longitude, s.status
          FROM route_stops rs
          JOIN job_stops s ON s.id = rs.job_stop_id
          WHERE rs.route_id = (
            SELECT id FROM routes
            WHERE tenant_id = ${row.tenant_id}
              AND driver_id = ${job.assigned_driver_id}
              AND status IN ('published', 'in_progress')
            ORDER BY version DESC
            LIMIT 1
          )
          ORDER BY rs.sequence_no
        `)) as unknown as Array<{
          sequence_no: number;
          stop_id: string;
          job_id: string;
          latitude: number;
          longitude: number;
          status: string;
        }>;
        const customerSequence = sequenceRows.find(
          (stop) => stop.job_id === row.job_id,
        );
        if (customerSequence) {
          const stopsAway = sequenceRows.filter(
            (stop) =>
              stop.sequence_no < customerSequence.sequence_no &&
              stop.status !== "completed" &&
              stop.status !== "skipped" &&
              stop.status !== "failed",
          ).length;
          const speedRows = (await db.execute(sql`
            SELECT COALESCE(AVG(speed_mps), 0)::float8 AS avg_speed
            FROM (
              SELECT speed_mps FROM location_points
              WHERE vehicle_id = ${job.assigned_vehicle_id}
                AND speed_mps IS NOT NULL
                AND captured_at > now() - interval '10 minutes'
              ORDER BY captured_at DESC
              LIMIT 5
            ) recent
          `)) as unknown as Array<{ avg_speed: number | null }>;
          const progress = computeLiveProgress(
            geometry,
            position.latitude,
            position.longitude,
            customerSequence.latitude,
            customerSequence.longitude,
            stopsAway,
            speedRows[0]?.avg_speed ?? 7,
          );
          if (progress) {
            liveProgress = progress;
          }
        }
      }
    }

    return {
      jobReference: job.reference,
      status: job.status,
      ...(etaValue !== null ? { eta: new Date(etaValue).toISOString() } : {}),
      etaMethod: "planned" as const,
      etaConfidence,
      delayStatus,
      ...(remainingStops > 0 ? { remainingStops } : {}),
      ...(liveProgress ? { liveProgress } : {}),
      ...(liveProgress
        ? {
            etaWindow: {
              fromMinutes: Math.max(
                1,
                liveProgress.etaMinutes -
                  Math.max(5, Math.ceil(liveProgress.etaMinutes * 0.25)),
              ),
              toMinutes:
                liveProgress.etaMinutes +
                Math.max(5, Math.ceil(liveProgress.etaMinutes * 0.25)),
            },
          }
        : {}),
      ...(position?.capturedAt ? { lastUpdateAt: position.capturedAt } : {}),
      ...(inCustomerZone !== undefined ? { inCustomerZone } : {}),
      ...(customerZoneName ? { customerZoneName } : {}),
      ...(proof ? { proof } : {}),
      ...(job.full_name ? { driverName: job.full_name } : {}),
      ...(job.registration ? { vehicleRegistration: job.registration } : {}),
      ...(position ? { position } : {}),
      stops: stops.map((stop) => ({
        sequence: Number(stop.sequence),
        address: stop.address,
        status: stop.status,
        ...(stop.arrived_at ? { arrivedAt: new Date(stop.arrived_at).toISOString() } : {}),
        ...(stop.completed_at ? { completedAt: new Date(stop.completed_at).toISOString() } : {}),
      })),
    };
  });
}

