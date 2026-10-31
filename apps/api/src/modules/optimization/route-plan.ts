/**
 * Route plan builder (Stage 1): derives version-scoped waypoints and legs
 * from the exact ordered stops and the routing engine's leg boundaries.
 * Never slices the full geometry by nearest point.
 */
import { randomUUID } from "node:crypto";
import type { GeoPoint, RouteLeg, RouteWaypoint } from "@privatefleet/contracts";

export interface PlanStopRef {
  stopId: string;
  jobId?: string;
  stopType?: "pickup" | "dropoff" | "service";
}

export interface RouterLegInput {
  points: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
}

export class RoutePlanError extends Error {}

function samePoint(a: GeoPoint, b: GeoPoint, tolerance = 0.00002): boolean {
  return (
    Math.abs(a.latitude - b.latitude) <= tolerance &&
    Math.abs(a.longitude - b.longitude) <= tolerance
  );
}

function arrivalIso(absoluteEpochSeconds: number | undefined): string | null {
  if (absoluteEpochSeconds === undefined || !Number.isFinite(absoluteEpochSeconds)) {
    return null;
  }
  return new Date(absoluteEpochSeconds * 1000).toISOString();
}

export function buildRoutePlan(input: {
  routeId?: string;
  geometry: GeoPoint[];
  legs: RouterLegInput[] | undefined;
  stops: PlanStopRef[];
  /** VROOM arrivals are absolute epoch seconds in this planner. */
  stopArrivals?: Array<number | undefined>;
}): { routeId: string; waypoints: RouteWaypoint[]; legs: RouteLeg[] } {
  const routeId = input.routeId ?? randomUUID();
  const geometry = input.geometry;
  if (geometry.length < 2) {
    throw new RoutePlanError("route geometry needs at least two points");
  }
  const legs = input.legs;
  if (!legs || legs.length < input.stops.length) {
    throw new RoutePlanError(
      `expected at least ${input.stops.length} router legs, got ${legs?.length ?? 0}`,
    );
  }
  const lastStopEnd = input.stops.length
    ? legs[input.stops.length - 1]?.points.at(-1)
    : undefined;
  const hasDestination =
    !lastStopEnd || !samePoint(geometry[geometry.length - 1]!, lastStopEnd, 0.0001);
  const expectedLegs = input.stops.length + (hasDestination ? 1 : 0);
  if (legs.length !== expectedLegs) {
    throw new RoutePlanError(`expected ${expectedLegs} router legs, got ${legs.length}`);
  }

  const waypoints: RouteWaypoint[] = [];
  const origin = geometry[0]!;
  waypoints.push({
    id: `${routeId}:waypoint:0`,
    sequence: 0,
    kind: "origin",
    location: origin,
  });

  for (const [index, stop] of input.stops.entries()) {
    const leg = legs[index];
    if (!leg || leg.points.length < 2) {
      throw new RoutePlanError(`router leg ${index} is incomplete`);
    }
    const location = leg.points[leg.points.length - 1]!;
    waypoints.push({
      id: `${routeId}:waypoint:${index + 1}`,
      sequence: index + 1,
      kind: "job_stop",
      jobStopId: stop.stopId,
      ...(stop.jobId ? { jobId: stop.jobId } : {}),
      ...(stop.stopType ? { stopType: stop.stopType } : {}),
      location,
      plannedArrivalAt: arrivalIso(input.stopArrivals?.[index]),
    });
  }

  if (hasDestination) {
    waypoints.push({
      id: `${routeId}:waypoint:${waypoints.length}`,
      sequence: waypoints.length,
      kind: "destination",
      location: geometry[geometry.length - 1]!,
    });
  }

  const builtLegs: RouteLeg[] = legs.map((leg, index) => {
    const from = waypoints[index]!;
    const to = waypoints[index + 1]!;
    if (!samePoint(leg.points[leg.points.length - 1]!, to.location, 0.0001)) {
      throw new RoutePlanError(`router leg ${index} does not end at waypoint ${to.sequence}`);
    }
    return {
      id: `${routeId}:leg:${index}`,
      sequence: index,
      fromWaypointId: from.id,
      toWaypointId: to.id,
      points: leg.points,
      distanceM: leg.distanceMetres,
      estimatedDurationS: leg.durationSeconds,
    };
  });

  return { routeId, waypoints, legs: builtLegs };
}
