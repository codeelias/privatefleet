/**
 * Route-progress mathematics for live customer ETAs. Pure functions:
 * project a vehicle position onto the published route polyline and derive
 * stops-away and remaining distance to a target stop.
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export function cumulative(points: GeoPoint[]): number[] {
  const distances: number[] = new Array(points.length);
  distances[0] = 0;
  for (let index = 1; index < points.length; index++) {
    const prev = points[index - 1];
    const next = points[index];
    if (!prev || !next) continue;
    distances[index] = distances[index - 1]! + distance(prev, next);
  }
  return distances;
}

/** Nearest position on the polyline; returns metres along the line. */
export function project(
  latitude: number,
  longitude: number,
  points: GeoPoint[],
  cumulativeDistances: number[],
): number {
  if (points.length < 2) return 0;
  let best = Number.MAX_VALUE;
  let bestAlong = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    if (!a || !b) continue;
    const projected = projectToSegment(latitude, longitude, a, b);
    const d = distance({ latitude, longitude }, projected);
    if (d < best) {
      best = d;
      bestAlong = (cumulativeDistances[index - 1] ?? 0) + distance(a, projected);
    }
  }
  return bestAlong;
}

export function nearestIndex(latitude: number, longitude: number, points: GeoPoint[]): number {
  let best = 0;
  let bestDistance = Number.MAX_VALUE;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) continue;
    const d = distance(point, { latitude, longitude });
    if (d < bestDistance) {
      bestDistance = d;
      best = index;
    }
  }
  return best;
}

/**
 * Compute live progress to a target stop. `stopsBefore` is the number of
 * incomplete stops sequenced before the target stop (0 = next delivery).
 */
export function computeLiveProgress(
  points: GeoPoint[],
  vehicleLatitude: number,
  vehicleLongitude: number,
  targetLatitude: number,
  targetLongitude: number,
  stopsBefore: number,
  speedMps: number,
): { stopsAway: number; etaMinutes: number } | null {
  if (points.length < 2) return null;
  const cumulativeDistances = cumulative(points);
  const alongVehicle = project(vehicleLatitude, vehicleLongitude, points, cumulativeDistances);
  const targetIndex = nearestIndex(targetLatitude, targetLongitude, points);
  const alongTarget = cumulativeDistances[targetIndex] ?? 0;
  const remaining = Math.max(0, alongTarget - alongVehicle);
  const effectiveSpeed = speedMps > 0.5 && speedMps < 40 ? speedMps : 7;
  return {
    stopsAway: Math.max(0, stopsBefore),
    etaMinutes: Math.ceil(remaining / effectiveSpeed / 60),
  };
}

function projectToSegment(
  latitude: number,
  longitude: number,
  a: GeoPoint,
  b: GeoPoint,
): GeoPoint {
  const ax = a.longitude;
  const ay = a.latitude;
  const bx = b.longitude;
  const by = b.latitude;
  const px = longitude;
  const py = latitude;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { latitude: a.latitude, longitude: a.longitude };
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return { latitude: ay + t * dy, longitude: ax + t * dx };
}

function distance(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.latitude - a.latitude) * 110_540;
  const dLng =
    (b.longitude - a.longitude) * 111_320 * Math.cos((Math.PI / 180) * (a.latitude + b.latitude) / 2);
  return Math.hypot(dLat, dLng);
}
