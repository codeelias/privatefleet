/**
 * Route leg hierarchy (Stage 2). Pure derivation: no React, no map library.
 * `next` means the first outstanding planned stop, not GPS-inferred progress.
 * Skipped/failed stops are exceptions, never successful completions.
 */
import type { GeoPoint } from "./geo.js";
import type { RoutePathLike } from "./geo.js";

export type LegStatus = "completed" | "exception" | "next" | "remaining" | "route";

export interface LegFeatureProperties {
  vehicleId: string;
  driverId: string;
  legId: string;
  sequence: number;
  status: LegStatus;
}

export interface RouteLegFeature {
  type: "Feature";
  properties: LegFeatureProperties;
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
}

export type StopStatusMap = ReadonlyMap<string, string>;

function coordinates(points: GeoPoint[]): Array<[number, number]> {
  return points.map((point) => [point.longitude, point.latitude]);
}

function legStatuses(route: RoutePathLike, stopStatus: StopStatusMap): LegStatus[] {
  const waypoints = route.waypoints ?? [];
  const statuses: LegStatus[] = [];
  let nextAssigned = false;
  for (let index = 0; index < (route.legs?.length ?? 0); index += 1) {
    const to = waypoints[index + 1];
    const stop = to?.jobStopId ? stopStatus.get(to.jobStopId) : undefined;
    if (to?.kind === "destination") {
      // Completing stops does not prove the vehicle reached the destination.
      statuses.push("remaining");
      nextAssigned = true;
      continue;
    }
    if (stop === "completed") {
      statuses.push("completed");
    } else if (stop === "skipped" || stop === "failed") {
      statuses.push("exception");
    } else if (!nextAssigned) {
      statuses.push("next");
      nextAssigned = true;
    } else {
      // Includes the destination leg: completing all stops does not prove
      // the vehicle reached the destination.
      statuses.push("remaining");
    }
  }
  return statuses;
}

export function routeLegFeatures(
  routes: RoutePathLike[],
  stopStatus: StopStatusMap,
): RouteLegFeature[] {
  const features: RouteLegFeature[] = [];
  for (const route of routes) {
    const waypoints = route.waypoints ?? [];
    const legs = route.legs ?? [];
    if (waypoints.length >= 2 && legs.length === waypoints.length - 1) {
      const statuses = legStatuses(route, stopStatus);
      for (const [index, leg] of legs.entries()) {
        features.push({
          type: "Feature",
          properties: {
            vehicleId: route.vehicleId,
            driverId: route.driverId ?? "",
            legId: leg.id,
            sequence: leg.sequence,
            status: statuses[index] ?? "remaining",
          },
          geometry: { type: "LineString", coordinates: coordinates(leg.points) },
        });
      }
      continue;
    }
    // Legacy route without legs: preserve full geometry as a single feature.
    features.push({
      type: "Feature",
      properties: {
        vehicleId: route.vehicleId,
        driverId: route.driverId ?? "",
        legId: "",
        sequence: 0,
        status: "route",
      },
      geometry: { type: "LineString", coordinates: coordinates(route.points) },
    });
  }
  return features;
}

