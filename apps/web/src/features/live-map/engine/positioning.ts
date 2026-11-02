/**
 * Positioning quality (Stage 3): pure route projection, confidence
 * classification and a bounded displayed-fix filter.
 *
 * This is deliberately separate from marker tweening. Tweening makes a
 * healthy fix glide; this module decides whether the fix is trustworthy,
 * whether it can be matched to the planned road route, and whether a jump
 * should be rejected.
 */
import type { GeoPoint, VehicleDto } from "@privatefleet/contracts";
import { haversineMetres, type RoutePathLike } from "./geo.js";

export type FixConfidence = "high" | "medium" | "low" | "unknown";

export interface RouteProjection {
  snapped: GeoPoint;
  /** Perpendicular distance from the raw fix to the planned route. */
  distanceM: number;
  legIndex: number;
  legProgressM: number;
  routeProgressM: number;
  totalM: number;
  remainingM: number;
}

export interface PositioningResult {
  location: GeoPoint;
  confidence: FixConfidence;
  stale: boolean;
  snapped: boolean;
  distanceToRouteM: number | null;
  legIndex: number | null;
  legProgressM: number | null;
  routeProgressM: number | null;
  remainingM: number | null;
  headingDeg: number | null;
  accuracyMetres: number | null;
  ageMs: number | null;
  observedAt: number | null;
  outlier: boolean;
}

interface Segment {
  from: GeoPoint;
  to: GeoPoint;
  legIndex: number;
  legStartM: number;
  lengthM: number;
}

const METRES_PER_DEGREE_LAT = 110_540;

function toXy(point: GeoPoint, reference: GeoPoint): { x: number; y: number } {
  const latRad = (reference.latitude * Math.PI) / 180;
  return {
    x: (point.longitude - reference.longitude) * 111_320 * Math.cos(latRad),
    y: (point.latitude - reference.latitude) * METRES_PER_DEGREE_LAT,
  };
}

function segments(route: RoutePathLike): { segments: Segment[]; totalM: number } {
  const result: Segment[] = [];
  const legs =
    route.legs && route.legs.length > 0
      ? route.legs.map((leg, index) => ({ points: leg.points, index }))
      : [{ points: route.points, index: 0 }];
  let legStartM = 0;
  let totalM = 0;
  for (const leg of legs) {
    for (let index = 1; index < leg.points.length; index += 1) {
      const from = leg.points[index - 1]!;
      const to = leg.points[index]!;
      const lengthM = haversineMetres(from, to);
      result.push({ from, to, legIndex: leg.index, legStartM, lengthM });
      legStartM += lengthM;
      totalM += lengthM;
    }
  }
  return { segments: result, totalM };
}

/**
 * Nearest point on the planned route, preserving leg and along-route
 * distance. Uses a local equirectangular projection, which is accurate at
 * city scale and cheap enough to run for every telemetry update.
 */
export function projectPointToRoute(
  point: GeoPoint,
  route: RoutePathLike,
): RouteProjection | null {
  const built = segments(route);
  if (built.segments.length === 0 || built.totalM === 0) return null;
  let best: RouteProjection | null = null;
  for (const segment of built.segments) {
    const origin = segment.from;
    const a = { x: 0, y: 0 };
    const b = toXy(segment.to, origin);
    const p = toXy(point, origin);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, (p.x * dx + p.y * dy) / denominator));
    const snapped = {
      latitude: segment.from.latitude + (segment.to.latitude - segment.from.latitude) * t,
      longitude: segment.from.longitude + (segment.to.longitude - segment.from.longitude) * t,
    };
    const distanceM = haversineMetres(point, snapped);
    if (!best || distanceM < best.distanceM) {
      const routeProgressM = segment.legStartM + segment.lengthM * t;
      best = {
        snapped,
        distanceM,
        legIndex: segment.legIndex,
        legProgressM: segment.lengthM * t,
        routeProgressM,
        totalM: built.totalM,
        remainingM: Math.max(0, built.totalM - routeProgressM),
      };
    }
  }
  return best;
}

export function confidenceFor(input: {
  stale: boolean;
  ageMs: number | null;
  accuracyMetres: number | null;
  distanceToRouteM: number | null;
}): FixConfidence {
  if (input.stale) return "low";
  if (input.ageMs === null) return "unknown";
  if (input.accuracyMetres === null) {
    // Device metrics are absent (e.g. older clients). A fresh, route-matched
    // fix is usable, but it must not be advertised as high confidence.
    if (input.ageMs <= 30_000 && (input.distanceToRouteM ?? Infinity) <= 35) return "medium";
    if (input.ageMs <= 60_000) return "low";
    return "low";
  }
  if (
    input.accuracyMetres <= 15 &&
    input.ageMs <= 15_000 &&
    (input.distanceToRouteM === null || input.distanceToRouteM <= 25)
  ) {
    return "high";
  }
  if (
    input.accuracyMetres <= 50 &&
    input.ageMs <= 45_000 &&
    (input.distanceToRouteM === null || input.distanceToRouteM <= 60)
  ) {
    return "medium";
  }
  return "low";
}

export function smoothAngle(from: number, to: number, alpha: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * Math.max(0, Math.min(1, alpha)) + 360) % 360;
}

export function bearingDegrees(from: GeoPoint, to: GeoPoint): number {
  const toRad = Math.PI / 180;
  const midLat = ((from.latitude + to.latitude) / 2) * toRad;
  const east = (to.longitude - from.longitude) * Math.cos(midLat);
  const north = to.latitude - from.latitude;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/**
 * Produce the displayed fix. The raw device location remains authoritative;
 * snapping is used only when the fix is fresh and near the planned route.
 * A physically implausible jump within a short interval is rejected and the
 * previous accepted fix is retained with low confidence.
 */
export function resolveVehicleFix(
  vehicle: VehicleDto,
  route: RoutePathLike | undefined,
  previous: PositioningResult | undefined,
  now: number,
): PositioningResult | null {
  if (!vehicle.location) return null;
  const lastSeen = vehicle.lastSeenAt ? Date.parse(vehicle.lastSeenAt) : Number.NaN;
  const ageMs = Number.isFinite(lastSeen) ? Math.max(0, now - lastSeen) : null;
  const observedAt = Number.isFinite(lastSeen) ? lastSeen : null;
  const stale =
    vehicle.stale ||
    vehicle.locationStatus === "stale" ||
    (ageMs !== null && ageMs > 60_000);
  const accuracyMetres = vehicle.accuracyMetres ?? null;
  const projection = route && route.points.length >= 2 ? projectPointToRoute(vehicle.location, route) : null;

  if (previous && !stale && observedAt !== null && previous.observedAt !== null) {
    const elapsedMs = observedAt - previous.observedAt;
    const jumpM = haversineMetres(previous.location, vehicle.location);
    // Reject only when the *sample* interval proves an impossible speed.
    // Re-rendering the same accepted sample must not reject it.
    const impliedSpeed = jumpM / Math.max(0.25, elapsedMs / 1000);
    if (elapsedMs > 0 && elapsedMs <= 15_000 && jumpM > 400 && impliedSpeed > 60) {
      return {
        ...previous,
        confidence: "low",
        outlier: true,
        ageMs,
      };
    }
  }

  let location = vehicle.location;
  let distanceToRouteM = projection?.distanceM ?? null;
  const snapLimit = Math.max(20, Math.min(45, (accuracyMetres ?? 35) * 1.5));
  const snapped = Boolean(projection && !stale && projection.distanceM <= snapLimit);
  if (projection && snapped) {
    location = projection.snapped;
  }
  if (previous && !stale) {
    const jumpM = haversineMetres(previous.location, location);
    // Short hops are smoothed; large legitimate moves retain responsiveness.
    const alpha = jumpM > 120 ? 0.85 : 0.55;
    location = {
      latitude: previous.location.latitude + (location.latitude - previous.location.latitude) * alpha,
      longitude: previous.location.longitude + (location.longitude - previous.location.longitude) * alpha,
    };
  }

  const confidence = confidenceFor({ stale, ageMs, accuracyMetres, distanceToRouteM });
  const telemetryHeading =
    vehicle.headingDeg !== null && vehicle.headingDeg !== undefined && Number.isFinite(vehicle.headingDeg)
      ? vehicle.headingDeg
      : null;
  const derivedHeading =
    previous && haversineMetres(previous.location, location) > 1
      ? bearingDegrees(previous.location, location)
      : null;
  const headingDeg =
    telemetryHeading ??
    (previous?.headingDeg !== null && previous?.headingDeg !== undefined && derivedHeading !== null
      ? smoothAngle(previous.headingDeg, derivedHeading, 0.45)
      : derivedHeading);

  return {
    location,
    confidence,
    stale,
    snapped,
    distanceToRouteM,
    legIndex: projection?.legIndex ?? null,
    legProgressM: projection?.legProgressM ?? null,
    routeProgressM: projection?.routeProgressM ?? null,
    remainingM: projection?.remainingM ?? null,
    headingDeg: headingDeg ?? null,
    accuracyMetres,
    ageMs,
    observedAt,
    outlier: false,
  };
}

