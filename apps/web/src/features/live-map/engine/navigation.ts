/**
 * Navigation read model (Stage 5): next manoeuvre, distance to it, remaining
 * route distance and ETA. It is derived from published route legs and their
 * OSRM steps; it never invents instructions for legacy routes without steps.
 */
import type { GeoPoint } from "@privatefleet/contracts";
import type { RoutePathLike } from "./geo.js";
import type { PositioningResult } from "./positioning.js";

export interface NextManeuver {
  instruction: string;
  maneuver: string;
  modifier?: string;
  exit?: number;
  roadName?: string;
  distanceM: number;
}

export interface NavigationState {
  nextManeuver: NextManeuver | null;
  remainingDistanceM: number | null;
  remainingDurationS: number | null;
  etaIso: string | null;
  hasInstructions: boolean;
  /** Whether the ETA blended live device speed or used planned duration only. */
  etaMethod: "live" | "planned";
  blendedSpeedMps: number | null;
}

function legDistance(leg: NonNullable<RoutePathLike["legs"]>[number]): number {
  return leg.points.reduce((sum, point, index) => {
    if (index === 0) return 0;
    return sum + distanceBetween(leg.points[index - 1]!, point);
  }, 0);
}

// Keep the navigation module dependency-light; this local haversine is only
// used to price legacy legs that did not carry a distance field.
function distanceBetween(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const lat = ((a.latitude + b.latitude) / 2) * toRad;
  const x = dLon * Math.cos(lat);
  return Math.hypot(x, dLat) * 6_371_000;
}

export function navigationFor(
  route: RoutePathLike,
  fix: Pick<PositioningResult, "legIndex" | "legProgressM" | "confidence" | "stale">,
  now: number,
  liveSpeedMps?: number | null,
): NavigationState {
  const legs = route.legs ?? [];
  if (legs.length === 0) {
    return {
      nextManeuver: null,
      remainingDistanceM: null,
      remainingDurationS: null,
      etaIso: null,
      hasInstructions: false,
      etaMethod: "planned",
      blendedSpeedMps: null,
    };
  }
  const legIndex = Math.min(Math.max(fix.legIndex ?? 0, 0), legs.length - 1);
  const leg = legs[legIndex]!;
  const progressM = Math.max(0, fix.legProgressM ?? 0);
  const distanceCache = new Map<number, number>();
  const distanceOf = (index: number): number => {
    const cached = distanceCache.get(index);
    if (cached !== undefined) return cached;
    const value = legDistance(legs[index]!);
    distanceCache.set(index, value);
    return value;
  };

  let remainingDistanceM = Math.max(0, distanceOf(legIndex) - progressM);
  let remainingDurationS = Math.max(
    0,
    legs[legIndex]!.estimatedDurationS * (distanceOf(legIndex) > 0 ? remainingDistanceM / distanceOf(legIndex) : 0),
  );
  for (let index = legIndex + 1; index < legs.length; index += 1) {
    remainingDistanceM += distanceOf(index);
    remainingDurationS += legs[index]!.estimatedDurationS;
  }

  let nextManeuver: NextManeuver | null = null;
  const steps = leg.steps ?? [];
  let cumulative = 0;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    cumulative += step.distanceM;
    if (cumulative <= progressM + 1 || !step.instruction) continue;
    const upcoming = steps[index + 1];
    if (upcoming) {
      nextManeuver = {
        instruction: upcoming.instruction,
        maneuver: upcoming.maneuver,
        ...(upcoming.modifier ? { modifier: upcoming.modifier } : {}),
        ...(upcoming.exit !== undefined ? { exit: upcoming.exit } : {}),
        ...(upcoming.roadName ? { roadName: upcoming.roadName } : {}),
        distanceM: Math.max(0, cumulative - progressM),
      };
    } else {
      const nextLeg = legs[legIndex + 1];
      const first = nextLeg?.steps?.[0];
      nextManeuver = first
        ? {
            instruction: first.instruction,
            maneuver: first.maneuver,
            ...(first.modifier ? { modifier: first.modifier } : {}),
            ...(first.exit !== undefined ? { exit: first.exit } : {}),
            ...(first.roadName ? { roadName: first.roadName } : {}),
            distanceM: Math.max(0, cumulative - progressM),
          }
        : {
            instruction: "Continue to the next stop",
            maneuver: "continue",
            distanceM: Math.max(0, cumulative - progressM),
          };
    }
    break;
  }

  const roundedDistanceM = Math.round(remainingDistanceM);
  let roundedDurationS = Math.round(remainingDurationS);
  let etaMethod: "live" | "planned" = "planned";
  let blendedSpeedMps: number | null = null;
  const plannedSpeedMps =
    remainingDurationS > 0 ? remainingDistanceM / remainingDurationS : 0;
  const speed =
    liveSpeedMps !== null && liveSpeedMps !== undefined && Number.isFinite(liveSpeedMps)
      ? Math.max(0, Math.min(40, liveSpeedMps))
      : 0;
  const weight =
    fix.stale || fix.confidence === "low" || fix.confidence === "unknown"
      ? 0
      : fix.confidence === "high"
        ? 0.6
        : fix.confidence === "medium"
          ? 0.35
          : 0;
  if (weight > 0 && speed > 0.5 && plannedSpeedMps > 0) {
    blendedSpeedMps = plannedSpeedMps * (1 - weight) + speed * weight;
    if (blendedSpeedMps > 0.2) {
      roundedDurationS = Math.round(remainingDistanceM / blendedSpeedMps);
      etaMethod = "live";
    }
  }
  if (!nextManeuver) {
    const nextLeg = legs[legIndex + 1];
    const first = nextLeg?.steps?.[0];
    if (first) {
      nextManeuver = {
        instruction: first.instruction,
        maneuver: first.maneuver,
        ...(first.modifier ? { modifier: first.modifier } : {}),
        ...(first.roadName ? { roadName: first.roadName } : {}),
        distanceM: Math.max(0, distanceOf(legIndex) - progressM),
      };
    }
  }

  return {
    nextManeuver,
    remainingDistanceM: roundedDistanceM,
    remainingDurationS: roundedDurationS,
    etaIso: new Date(now + roundedDurationS * 1000).toISOString(),
    hasInstructions: steps.length > 0,
    etaMethod,
    blendedSpeedMps,
  };
}

export function formatNavigationDistance(distanceM: number | null): string {
  if (distanceM === null || !Number.isFinite(distanceM)) return "-";
  if (distanceM < 1000) return `${Math.max(0, Math.round(distanceM / 10) * 10)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

export function formatNavigationEta(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

