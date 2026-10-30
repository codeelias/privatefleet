/**
 * Query-time trip/stop segmentation over location_points (Stage 4, commit 2).
 * Computed on request from the indexed telemetry history - no materialized
 * state, no background worker. Thresholds are explicit and gap-safe: a
 * telemetry gap longer than maxGapS never bridges two segments.
 *
 * - Trip: speed >= tripSpeedMps sustained for at least tripMinS.
 * - Stop: cluster whose points stay within stopRadiusM of the FIRST anchor
 *   point for at least stopMinS (a fixed anchor prevents gradual drift from
 *   expanding the cluster).
 */
import { sql } from "drizzle-orm";
import type { GeoPoint, StopSegment, StopReport, TripReport, TripSegment } from "@privatefleet/contracts";
import { withTenant, type Database, type DbHandle } from "../../db/client.js";

const TRIP_SPEED_MPS = 2.2352; // 5 mph
const TRIP_MIN_S = 120;
const STOP_RADIUS_M = 50;
const STOP_MIN_S = 180;
const MAX_GAP_S = 300;
const MAX_POINTS = 60_000;

interface PointRow {
  captured_at: Date | string;
  latitude: number;
  longitude: number;
  speed_mps: number | string | null;
}

function epoch(value: Date | string): number {
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(s));
}

async function pointsFor(
  db: Database,
  tenantId: string,
  vehicleId: string,
  from: Date,
  to: Date,
): Promise<PointRow[]> {
  const rows = (await db.execute(sql`
    SELECT captured_at, latitude, longitude, speed_mps
    FROM location_points
    WHERE tenant_id = ${tenantId} AND vehicle_id = ${vehicleId}
      AND captured_at >= ${from.toISOString()} AND captured_at <= ${to.toISOString()}
    ORDER BY captured_at ASC
    LIMIT ${MAX_POINTS}
  `)) as unknown as PointRow[];
  return rows;
}

export interface SegmentationParams {
  vehicleId: string;
  from: string;
  to: string;
}

export async function tripsReport(
  handle: DbHandle,
  tenantId: string,
  params: SegmentationParams,
): Promise<TripReport> {
  return withTenant(handle, tenantId, async (db) => {
    const from = new Date(params.from);
    const to = new Date(params.to);
    const points = await pointsFor(db, tenantId, params.vehicleId, from, to);
    const segments: TripSegment[] = [];
    let start: PointRow | null = null;
    let previous: PointRow | null = null;
    let distance = 0;
    let count = 0;
    let maxSpeed = 0;

    const closeTrip = (end: PointRow): void => {
      if (start && previous && count > 0) {
        const durationS = Math.round((epoch(previous.captured_at) - epoch(start.captured_at)) / 1000);
        if (durationS >= TRIP_MIN_S) {
          segments.push({
            startedAt: new Date(epoch(start.captured_at)).toISOString(),
            endedAt: new Date(epoch(previous.captured_at)).toISOString(),
            durationS,
            distanceM: Math.round(distance),
            points: count,
            ...(maxSpeed > 0 ? { maxSpeedMps: Math.round(maxSpeed * 100) / 100 } : {}),
            startLocation: { latitude: start.latitude, longitude: start.longitude },
            endLocation: { latitude: end.latitude, longitude: end.longitude },
          });
        }
      }
      start = null;
      previous = null;
      distance = 0;
      count = 0;
      maxSpeed = 0;
    };

    for (const point of points) {
      const speed = point.speed_mps === null || point.speed_mps === undefined ? null : Number(point.speed_mps);
      const gap = previous ? epoch(point.captured_at) - epoch(previous.captured_at) : 0;
      const moving = speed !== null && speed >= TRIP_SPEED_MPS && gap <= MAX_GAP_S * 1000;
      if (moving) {
        if (!start) {
          start = point;
          previous = point;
          count = 1;
          distance = 0;
          maxSpeed = speed!;
        } else if (start && previous) {
          distance += haversineM(previous.latitude, previous.longitude, point.latitude, point.longitude);
          previous = point;
          count += 1;
          maxSpeed = Math.max(maxSpeed, speed!);
        }
      } else if (start) {
        closeTrip(previous ?? point);
      } else {
        previous = null;
      }
    }
    if (start) {
      closeTrip(points[points.length - 1]!);
    }
    return {
      generatedAt: new Date().toISOString(),
      vehicleId: params.vehicleId,
      from: from.toISOString(),
      to: to.toISOString(),
      segments,
    };
  });
}

export async function stopsReport(
  handle: DbHandle,
  tenantId: string,
  params: SegmentationParams,
): Promise<StopReport> {
  return withTenant(handle, tenantId, async (db) => {
    const from = new Date(params.from);
    const to = new Date(params.to);
    const points = await pointsFor(db, tenantId, params.vehicleId, from, to);
    const segments: StopSegment[] = [];
    let anchor: PointRow | null = null;
    let previous: PointRow | null = null;
    let count = 0;
    let maxRadius = 0;
    let latSum = 0;
    let lngSum = 0;

    const closeStop = (): void => {
      if (anchor && previous && count > 0) {
        const durationS = Math.round((epoch(previous.captured_at) - epoch(anchor.captured_at)) / 1000);
        if (durationS >= STOP_MIN_S) {
          segments.push({
            startedAt: new Date(epoch(anchor.captured_at)).toISOString(),
            endedAt: new Date(epoch(previous.captured_at)).toISOString(),
            durationS,
            maxRadiusM: Math.round(maxRadius),
            points: count,
            location: {
              latitude: Math.round((latSum / count) * 1e6) / 1e6,
              longitude: Math.round((lngSum / count) * 1e6) / 1e6,
            },
          });
        }
      }
      anchor = null;
      previous = null;
      count = 0;
      maxRadius = 0;
      latSum = 0;
      lngSum = 0;
    };

    for (const point of points) {
      const gap = previous ? epoch(point.captured_at) - epoch(previous.captured_at) : 0;
      if (anchor && previous && gap <= MAX_GAP_S * 1000) {
        const radius = haversineM(anchor.latitude, anchor.longitude, point.latitude, point.longitude);
        if (radius <= STOP_RADIUS_M) {
          previous = point;
          count += 1;
          maxRadius = Math.max(maxRadius, radius);
          latSum += point.latitude;
          lngSum += point.longitude;
          continue;
        }
      }
      closeStop();
      anchor = point;
      previous = point;
      count = 1;
      maxRadius = 0;
      latSum = point.latitude;
      lngSum = point.longitude;
    }
    closeStop();
    return {
      generatedAt: new Date().toISOString(),
      vehicleId: params.vehicleId,
      from: from.toISOString(),
      to: to.toISOString(),
      segments,
    };
  });
}

export type { GeoPoint };
