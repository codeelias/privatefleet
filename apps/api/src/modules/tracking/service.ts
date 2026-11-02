/**
 * Phase 4 telemetry ingestion (docs/09): authenticated driver-device
 * batches become durable location_points rows and the hot vehicles
 * position in one tenant-scoped transaction. Out-of-order samples are
 * rejected, never replayed backwards.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  TelemetryBatch,
  TelemetryIngestResult,
  TelemetrySample,
  VehiclePosition,
} from "@privatefleet/contracts";
import { EVENT_SCHEMA_VERSION } from "@privatefleet/contracts";
import { withTenant, type Database, type DbHandle } from "../../db/client.js";

export class TrackingError extends Error {
  constructor(readonly code: "DRIVER_HAS_NO_VEHICLE") {
    super(code);
  }
}

interface VehicleRow {
  id: string;
  registration: string;
  captured_at: Date | string | null;
  max_seq: number | string | null;
}

interface GeofenceRow {
  id: string;
  name: string;
  job_id: string | null;
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
      SELECT v.id, v.registration, v.captured_at,
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

    const geofences = (await db.execute(sql`
      SELECT id, name, job_id FROM geofences
      WHERE tenant_id = ${tenantId} AND enabled = true
      ORDER BY created_at
    `)) as unknown as GeofenceRow[];
    const stateRows = geofences.length
      ? ((await db.execute(sql`
          SELECT geofence_id, inside FROM geofence_states WHERE vehicle_id = ${vehicle.id}
        `)) as unknown as Array<{ geofence_id: string; inside: boolean }>)
      : [];
    const states = new Map(stateRows.map((row) => [row.geofence_id, row.inside]));

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

      await evaluateGeofences(
        db,
        tenantId,
        vehicle,
        sample,
        geofences,
        states,
      );

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

/**
 * PostGIS geofence evaluation for one accepted position. Enter/exit
 * transitions write one outbox event and one alert, made idempotent by the
 * persistent per-vehicle/per-geofence state map.
 */
async function evaluateGeofences(
  db: Database,
  tenantId: string,
  vehicle: VehicleRow,
  sample: TelemetrySample,
  geofences: GeofenceRow[],
  states: Map<string, boolean>,
): Promise<void> {
  if (geofences.length === 0) {
    return;
  }
  const insideRows = (await db.execute(sql`
    SELECT g.id,
           ST_Contains(g.geom, ST_SetSRID(ST_MakePoint(${sample.longitude}, ${sample.latitude}), 4326)) AS inside
    FROM geofences g
    WHERE g.tenant_id = ${tenantId} AND g.enabled = true
  `)) as unknown as Array<{ id: string; inside: boolean }>;
  const nowInside = new Map(insideRows.map((row) => [row.id, row.inside]));

  for (const geofence of geofences) {
    const inside = nowInside.get(geofence.id) ?? false;
    const previous = states.get(geofence.id);
    if (previous !== undefined && previous !== inside) {
      const eventType = inside ? "geofence.entered" : "geofence.exited";
      const envelope = {
        eventId: randomUUID(),
        schemaVersion: EVENT_SCHEMA_VERSION,
        tenantId,
        aggregateType: "vehicle",
        aggregateId: vehicle.id,
        type: eventType,
        occurredAt: new Date().toISOString(),
        payload: {
          vehicleId: vehicle.id,
          geofenceId: geofence.id,
          geofenceName: geofence.name,
          ...(geofence.job_id ? { jobId: geofence.job_id } : {}),
          inside,
          latitude: sample.latitude,
          longitude: sample.longitude,
        },
      };
      await db.execute(sql`
        INSERT INTO outbox
          (id, tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES
          (${envelope.eventId}, ${tenantId}, 'vehicle', ${vehicle.id},
           ${eventType}, ${JSON.stringify(envelope)}::jsonb)
      `);
      await db.execute(sql`
        INSERT INTO alerts
          (id, tenant_id, severity, status, title, entity, location, freshness,
           recommended_action, reference, job_id, stop_id)
        VALUES
          (${randomUUID()}, ${tenantId}, ${inside ? "info" : "at_risk"}, 'open',
           ${`${inside ? "Entered" : "Exited"} geofence ${geofence.name}`},
           ${`Vehicle ${vehicle.registration}`},
           ${`${sample.latitude.toFixed(5)}, ${sample.longitude.toFixed(5)}`},
           ${`Reported ${new Date().toISOString()}`},
           'Review vehicle location and current route.',
           ${vehicle.id}, ${geofence.job_id ?? null}, NULL)
      `);
    }
    states.set(geofence.id, inside);
    await db.execute(sql`
      INSERT INTO geofence_states
        (tenant_id, vehicle_id, geofence_id, inside, last_captured_at, updated_at)
      VALUES
        (${tenantId}, ${vehicle.id}, ${geofence.id}, ${inside}, ${sample.capturedAt}, now())
      ON CONFLICT (vehicle_id, geofence_id) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        inside = EXCLUDED.inside,
        last_captured_at = EXCLUDED.last_captured_at,
        updated_at = now()
    `);
  }
}
