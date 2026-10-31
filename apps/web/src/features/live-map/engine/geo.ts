/**
 * Geographic primitives and route invariants for the map engine
 * (docs/17). Pure functions only: no React, no map-library coupling, so
 * the invariants can be unit-tested deterministically.
 */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface RoutePathLike {
  vehicleId: string;
  driverId?: string | undefined;
  points: GeoPoint[];
  waypoints?: Array<{
    id: string;
    sequence: number;
    kind: "origin" | "job_stop" | "destination";
    jobStopId?: string;
    jobId?: string;
    stopType?: "pickup" | "dropoff" | "service";
    location: GeoPoint;
    plannedArrivalAt?: string | null;
  }>;
  legs?: Array<{
    id: string;
    sequence: number;
    fromWaypointId: string;
    toWaypointId: string;
    points: GeoPoint[];
    distanceM: number;
    estimatedDurationS: number;
  }>;
}

export interface RouteValidation {
  valid: boolean;
  errors: string[];
  /** Total road length in metres (0 when the geometry is unusable). */
  lengthMetres: number;
}

export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  // Degrees scaled by metres-per-degree (the same convention the demo
  // simulator uses; accurate enough for validation tolerances).
  const dLat = b.latitude - a.latitude;
  const dLon = b.longitude - a.longitude;
  const latRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const x = dLon * 111_320 * Math.cos(latRad);
  const y = dLat * 110_540;
  return Math.sqrt(x * x + y * y);
}

export function isValidGeoPoint(point: GeoPoint | undefined): boolean {
  if (!point) {
    return false;
  }
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

/**
 * Required route invariants (docs/16.4, docs/17):
 * valid coordinates, a LineString of at least two distinct positions,
 * and no zero-length duplicated pairs.
 */
export function validateRoutePath(route: RoutePathLike): RouteValidation {
  const errors: string[] = [];
  if (!route.vehicleId) {
    errors.push("missing vehicleId");
  }
  if (!Array.isArray(route.points) || route.points.length < 2) {
    errors.push("route needs at least two points");
    return { valid: false, errors, lengthMetres: 0 };
  }
  let lengthMetres = 0;
  for (let index = 0; index < route.points.length; index += 1) {
    const point = route.points[index];
    if (!isValidGeoPoint(point)) {
      errors.push(`invalid coordinates at index ${index}`);
      continue;
    }
    const previous = route.points[index - 1];
    if (previous && isValidGeoPoint(previous)) {
      const distance = haversineMetres(previous, point!);
      lengthMetres += distance;
    }
  }
  if (lengthMetres === 0 && errors.length === 0) {
    errors.push("route has no length");
  }
  return { valid: errors.length === 0, errors, lengthMetres };
}

/** Stable signature of a route's geometry + owner, rounded to ~1m. */
export function routeSignature(route: RoutePathLike): string {
  let hash = 0x811c9dc5;
  const feed = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  feed(route.vehicleId);
  feed(route.driverId ?? "");
  feed(String(route.points.length));
  for (const point of route.points) {
    feed(point.latitude.toFixed(5));
    feed(point.longitude.toFixed(5));
  }
  return hash.toString(16).padStart(8, "0");
}

/** Human-readable distance for UI copy. */
export function formatMetres(metres: number): string {
  if (metres >= 1000) {
    return `${(metres / 1000).toFixed(1)} km`;
  }
  return `${Math.round(metres)} m`;
}

