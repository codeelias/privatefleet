/**
 * Cost-aware assignment recommendations. This is advisory only: the
 * dispatcher decides whether to assign work. Costs are incremental to the
 * driver's existing published route (detour fuel/vehicle + extra wage).
 */
import type { GeoPoint } from "@privatefleet/contracts";

export interface Economics {
  fuelPencePerKm: number;
  vehiclePencePerKm: number;
  driverPencePerHour: number;
  /** Maximum distance from an existing stop to consider a job "on the way". */
  maxDetourKm: number;
}

export interface RouteCandidate {
  driverId: string;
  driverName: string;
  vehicleId: string;
  registration: string;
  stops: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
  stopCount: number;
  limits: {
    maxDistanceM: number;
    maxTravelTimeS: number;
    maxWorkingDurationS: number;
    maxVisits: number;
  };
}

export interface UnassignedJobCandidate {
  jobId: string;
  reference: string;
  priority: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export interface Recommendation {
  jobId: string;
  reference: string;
  priority: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  registration: string;
  detourKm: number;
  addedMinutes: number;
  addedCostPence: number;
  currentRouteCostPence: number;
  reason: string;
}

export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const radius = 6_371_000;
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function nearestMetres(point: GeoPoint, stops: GeoPoint[]): number {
  if (stops.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...stops.map((stop) => haversineMetres(point, stop)));
}

export function routeCostPence(
  distanceMetres: number,
  durationSeconds: number,
  economics: Economics,
): number {
  const distanceKm = distanceMetres / 1000;
  const running = distanceKm * (economics.fuelPencePerKm + economics.vehiclePencePerKm);
  const wage = (durationSeconds / 3600) * economics.driverPencePerHour;
  return Math.round(running + wage);
}

export function buildRecommendations(
  route: RouteCandidate,
  jobs: UnassignedJobCandidate[],
  economics: Economics,
  options: { maxResults?: number; serviceMinutesPerVisit?: number } = {},
): Recommendation[] {
  const serviceMinutes = options.serviceMinutesPerVisit ?? 5;
  const results: Recommendation[] = [];
  for (const job of jobs) {
    // Pickup and drop-off must both be close to the existing sequence.
    const pickupDistance = nearestMetres(job.pickup, route.stops);
    const dropoffDistance = nearestMetres(job.dropoff, route.stops);
    const nearestKm = Math.max(pickupDistance, dropoffDistance) / 1000;
    if (nearestKm > economics.maxDetourKm) continue;

    // Out-and-back road estimate with a conservative 1.4 road factor.
    const detourKm =
      ((pickupDistance + dropoffDistance) / 1000) * 1.4 + 2;
    const addedMinutes = Math.round((detourKm / 25) * 60 + serviceMinutes * 2);
    const workingSeconds =
      route.durationSeconds + addedMinutes * 60;
    if (route.stopCount + 2 > route.limits.maxVisits) continue;
    if (route.distanceMetres + detourKm * 1000 > route.limits.maxDistanceM) continue;
    if (route.durationSeconds + addedMinutes * 60 > route.limits.maxTravelTimeS) continue;
    if (workingSeconds > route.limits.maxWorkingDurationS) continue;

    const addedCostPence = routeCostPence(
      detourKm * 1000,
      addedMinutes * 60,
      economics,
    );
    const currentRouteCostPence = routeCostPence(
      route.distanceMetres,
      route.durationSeconds,
      economics,
    );
    results.push({
      jobId: job.jobId,
      reference: job.reference,
      priority: job.priority,
      driverId: route.driverId,
      driverName: route.driverName,
      vehicleId: route.vehicleId,
      registration: route.registration,
      detourKm: Math.round(detourKm * 10) / 10,
      addedMinutes,
      addedCostPence,
      currentRouteCostPence,
      reason: `${job.reference}: pickup ${(pickupDistance / 1000).toFixed(1)} km, drop-off ${(dropoffDistance / 1000).toFixed(1)} km from ${route.driverName}'s current sequence. Adds about ${Math.round(detourKm * 10) / 10} km and ${addedMinutes} min; route stays inside ${route.limits.maxVisits} visits and policy limits.`,
    });
  }
  return results
    .sort((a, b) => a.addedCostPence - b.addedCostPence)
    .slice(0, options.maxResults ?? 5);
}
