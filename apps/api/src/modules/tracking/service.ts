/**
 * Phase 4 telemetry ingestion (docs/09): authenticated driver-device
 * batches become durable location_points rows and the hot vehicles
 * position in one tenant-scoped transaction. Out-of-order samples are
 * rejected, never replayed backwards.
 */
import { sql } from "drizzle-orm";
import type {
  TelemetryBatch,
  TelemetryIngestResult,
  VehiclePosition,
} from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";

export class TrackingError extends Error {
  constructor(readonly code: "DRIVER_HAS_NO_VEHICLE") {
    super(code);
  }
}

interface VehicleRow {
  id: string;
  captured_at: Date | string | null;
  max_seq: number | string | null;
}

export interface IngestOutcome {
  result: TelemetryIngestResult;
  /** Accepted positions, in acceptance order, for socket fan-out. */
  positions: VehiclePosition[];
}

/** Samples further in the future than this are treated as invalid. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export async function ingestTelemetry(
  handle: DbHandle,
  tenantId: string,
  driverId: string,
  batch: TelemetryBatch,
): Promise<IngestOutcome> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      SELECT v.id, v.captured_at,
             (SELECT coalesce(max(lp.sequence_no), 0)
                FROM location_points lp WHERE lp.vehicle_id = v.id) AS max_seq
      FROM vehicles v
      JOIN drivers d ON d.vehicle_id = v.id
      WHERE d.id = ${driverId}
      LIMIT 1
    `)) as unknown as VehicleRow[];
    const vehicle = rows[0];
    if (!vehicle) {
      throw new TrackingError("DRIVER_HAS_NO_VEHICLE");
    }

    let lastCaptured = vehicle.captured_at ? new Date(vehicle.captured_at).getTime() : 0;
    let sequence = Number(vehicle.max_seq ?? 0);
    const futureLimit = Date.now() + FUTURE_TOLERANCE_MS;
    const results: TelemetryIngestResult["results"] = [];
    const positions: VehiclePosition[] = [];
    let newest: TelemetryIngestResult["lastPosition"];

    for (const sample of batch.samples) {
      const capturedMs = Date.parse(sample.capturedAt);
      if (!Number.isFinite(capturedMs) || capturedMs > futureLimit) {
        results.push({
          status: "invalid",
          capturedAt: sample.capturedAt,
          reason: "CAPTURED_AT_INVALID",
        });
        continue;
      }
      // Monotonic: a sample at or before the current position is stale.
      if (capturedMs <= lastCaptured) {
        results.push({
          status: "stale",
          capturedAt: sample.capturedAt,
          reason: "CAPTURED_AT_NOT_NEWER",
        });
        continue;
      }
      sequence += 1;
      await db.execute(sql`
        INSERT INTO location_points
          (tenant_id, vehicle_id, driver_id, captured_at, latitude, longitude,
           accuracy_metres, heading_deg, speed_mps, sequence_no)
        VALUES
          (${tenantId}, ${vehicle.id}, ${driverId}, ${sample.capturedAt},
           ${sample.latitude}, ${sample.longitude},
           ${sample.accuracyMetres ?? null}, ${sample.headingDeg ?? null},
           ${sample.speedMps ?? null}, ${sequence})
      `);
      await db.execute(sql`
        UPDATE vehicles
        SET latitude = ${sample.latitude},
            longitude = ${sample.longitude},
            captured_at = ${sample.capturedAt},
            status = CASE WHEN status = 'available' THEN 'on_route'::vehicle_status ELSE status END
        WHERE id = ${vehicle.id}
      `);
      await db.execute(sql`UPDATE drivers SET last_ping_at = now() WHERE id = ${driverId}`);

      lastCaptured = capturedMs;
      const position: VehiclePosition = {
        vehicleId: vehicle.id,
        driverId,
        latitude: sample.latitude,
        longitude: sample.longitude,
        capturedAt: sample.capturedAt,
        sequenceNo: sequence,
        ...(sample.headingDeg !== undefined ? { headingDeg: sample.headingDeg } : {}),
      };
      positions.push(position);
      results.push({
        status: "accepted",
        capturedAt: sample.capturedAt,
        sequenceNo: sequence,
      });
      newest = {
        latitude: sample.latitude,
        longitude: sample.longitude,
        capturedAt: sample.capturedAt,
        sequenceNo: sequence,
      };
    }

    return {
      result: {
        accepted: positions.length,
        rejected: results.length - positions.length,
        results,
        ...(newest ? { lastPosition: newest } : {}),
      },
      positions,
    };
  });
}
