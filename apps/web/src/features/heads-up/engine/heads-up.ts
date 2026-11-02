/**
 * Heads-Up risk model.
 *
 * Deterministic, client-side operational intelligence over the authoritative
 * fleet state. It does not call a traffic provider and does not invent ETAs:
 * predicted arrival is the remaining published-leg duration from the vehicle's
 * current projected position. Every item names its evidence and recommended
 * action.
 */
import type { FleetState, JobDto, JobStopDto, RoutePath } from "@privatefleet/contracts";
import { projectPointToRoute } from "../../live-map/engine/positioning";
import type { RoutePathLike } from "../../live-map/engine/geo";

export type HeadsUpKind = "late" | "unassigned" | "stale_gps" | "off_route" | "no_route";
export type HeadsUpSeverity = "critical" | "warning" | "info";

export interface HeadsUpItem {
  id: string;
  kind: HeadsUpKind;
  severity: HeadsUpSeverity;
  title: string;
  detail: string;
  recommendation: string;
  jobId?: string;
  driverId?: string;
  vehicleId?: string;
  dueAt?: string;
  minutesLate?: number;
}

export interface HeadsUpSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  late: number;
  unassigned: number;
  stale: number;
  offRoute: number;
}

export interface HeadsUpResult {
  items: HeadsUpItem[];
  summary: HeadsUpSummary;
}

const LATE_BUFFER_MS = 5 * 60_000;
const OFF_ROUTE_METRES = 150;

function ms(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function stopById(state: FleetState): Map<string, { job: JobDto; stop: JobStopDto }> {
  const result = new Map<string, { job: JobDto; stop: JobStopDto }>();
  for (const job of state.jobs) {
    for (const stop of job.stops) result.set(stop.id, { job, stop });
  }
  return result;
}

/**
 * Remaining planned duration from the current projected position to a
 * waypoint. The route's legs are authoritative; no speed guess is used.
 */
function durationToWaypoint(
  route: RoutePath,
  currentLeg: number,
  legProgressM: number,
  targetWaypointSequence: number,
): number | null {
  const legs = route.legs;
  if (!legs || legs.length === 0) return null;
  const targetLeg = targetWaypointSequence - 1;
  if (targetLeg < 0 || targetLeg >= legs.length) return null;
  if (targetLeg < currentLeg) return 0;
  const current = legs[currentLeg];
  if (!current) return null;
  const currentDistance = Number(current.distanceM);
  const fractionRemaining =
    currentDistance > 0 ? Math.max(0, Math.min(1, 1 - legProgressM / currentDistance)) : 1;
  let seconds = current.estimatedDurationS * fractionRemaining;
  for (let index = currentLeg + 1; index <= targetLeg; index += 1) {
    seconds += legs[index]?.estimatedDurationS ?? 0;
  }
  return seconds;
}

function severityRank(severity: HeadsUpSeverity): number {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}

function addItem(map: Map<string, HeadsUpItem>, item: HeadsUpItem): void {
  const existing = map.get(item.id);
  if (!existing || severityRank(item.severity) < severityRank(existing.severity)) {
    map.set(item.id, item);
  }
}

export function buildHeadsUp(state: FleetState, now = Date.now()): HeadsUpResult {
  const items = new Map<string, HeadsUpItem>();
  const stops = stopById(state);
  const routesByDriver = new Map(
    state.routes
      .filter((route) => route.driverId)
      .map((route) => [route.driverId!, route]),
  );

  for (const route of state.routes) {
    const vehicle = state.vehicles.find((candidate) => candidate.id === route.vehicleId);
    if (!vehicle) continue;
    const projection =
      vehicle.location && route.points.length >= 2
        ? projectPointToRoute(vehicle.location, route as unknown as RoutePathLike)
        : null;

    if (projection && projection.distanceM > OFF_ROUTE_METRES && !vehicle.stale && vehicle.locationStatus !== "stale") {
      addItem(items, {
        id: `off_route:${vehicle.id}`,
        kind: "off_route",
        severity: "warning",
        title: "Vehicle is off the planned route",
        detail: `${vehicle.registration} is ${Math.round(projection.distanceM)} m from the published line.`,
        recommendation: "Confirm the driver is following the current plan, then refresh the route if the road change is legitimate.",
        ...(vehicle.driverId ? { driverId: vehicle.driverId } : {}),
        vehicleId: vehicle.id,
      });
    }

    if (!vehicle.location || vehicle.stale) {
      continue;
    }
    if (!projection || !route.legs || !route.waypoints) continue;

    for (const waypoint of route.waypoints) {
      if (waypoint.kind !== "job_stop" || !waypoint.jobStopId) continue;
      const reference = stops.get(waypoint.jobStopId);
      if (!reference) continue;
      const { job, stop } = reference;
      if (stop.status === "completed" || stop.status === "skipped" || stop.status === "failed") {
        continue;
      }
      const windowEnd = ms(stop.windowEnd);
      if (windowEnd === null) continue;
      const remainingSeconds = durationToWaypoint(
        route,
        projection.legIndex ?? 0,
        projection.legProgressM ?? 0,
        waypoint.sequence,
      );
      if (remainingSeconds === null) continue;
      const predictedAt = now + remainingSeconds * 1000;
      if (predictedAt <= windowEnd - LATE_BUFFER_MS) continue;
      const minutesLate = Math.max(0, Math.round((predictedAt - windowEnd) / 60_000));
      const critical = minutesLate >= 15 || job.priority === "stat";
      const eta = new Date(predictedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const windowLabel = new Date(windowEnd).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      addItem(items, {
        id: `late:${job.id}`,
        kind: "late",
        severity: critical ? "critical" : "warning",
        title: `${job.reference} projected ${minutesLate > 0 ? `${minutesLate} min late` : "at window edge"}`,
        detail: `${stop.stopType === "pickup" ? "Pickup" : "Drop-off"} predicted ${eta}, window closes ${windowLabel}. ${stop.address}`,
        recommendation:
          "Reassign, prioritise this stop, or contact the customer before the window closes.",
        jobId: job.id,
        ...(job.assignedDriverId ? { driverId: job.assignedDriverId } : {}),
        vehicleId: route.vehicleId,
        ...(stop.windowEnd ? { dueAt: stop.windowEnd } : {}),
        minutesLate,
      });
    }
  }

  for (const vehicle of state.vehicles) {
    const stale = vehicle.stale || vehicle.locationStatus === "stale";
    if (!stale) continue;
    const age = vehicle.lastSeenAt
      ? Math.max(0, Math.round((now - (ms(vehicle.lastSeenAt) ?? now)) / 60_000))
      : null;
    addItem(items, {
      id: `stale:${vehicle.id}`,
      kind: "stale_gps",
      severity: "warning",
      title: `Tracking stale for ${vehicle.registration}`,
      detail: age !== null ? `No fresh fix for ${age} min.` : "No usable timestamp on the last position.",
      recommendation: "Check the driver device and connectivity; do not dispatch on the last-known pin.",
      ...(vehicle.driverId ? { driverId: vehicle.driverId } : {}),
      vehicleId: vehicle.id,
    });
  }

  for (const job of state.jobs) {
    if (job.status !== "unassigned") {
      const route = job.assignedDriverId ? routesByDriver.get(job.assignedDriverId) : undefined;
      if (job.assignedDriverId && !route && (job.status === "assigned" || job.status === "in_progress")) {
        addItem(items, {
          id: `no_route:${job.id}`,
          kind: "no_route",
          severity: "warning",
          title: `${job.reference} has no published route`,
          detail: "Assignment exists but the driver has no active route version.",
          recommendation: "Run optimisation or reassign before the driver departs.",
          jobId: job.id,
          ...(job.assignedDriverId ? { driverId: job.assignedDriverId } : {}),
        });
      }
      continue;
    }
    const pickup = job.stops.find((stop) => stop.stopType === "pickup") ?? job.stops[0];
    const opensAt = ms(pickup?.windowStart);
    if (opensAt === null) continue;
    const minutesToWindow = Math.round((opensAt - now) / 60_000);
    if (minutesToWindow > 60) continue;
    const overdue = minutesToWindow <= 0;
    addItem(items, {
      id: `unassigned:${job.id}`,
      kind: "unassigned",
      severity: overdue || job.priority === "stat" ? "critical" : "warning",
      title: `${job.reference} unassigned${overdue ? " and overdue" : ""}`,
      detail: `${job.priority.toUpperCase()} job, window opens ${new Date(opensAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. ${pickup?.address ?? ""}`,
      recommendation: "Assign a compliant vehicle before the customer window opens.",
      jobId: job.id,
      ...(pickup?.windowStart ? { dueAt: pickup.windowStart } : {}),
    });
  }

  const ordered = [...items.values()].sort((left, right) => {
    const severity = severityRank(left.severity) - severityRank(right.severity);
    if (severity !== 0) return severity;
    return (left.minutesLate ?? 0) - (right.minutesLate ?? 0);
  });
  const summary: HeadsUpSummary = {
    total: ordered.length,
    critical: ordered.filter((item) => item.severity === "critical").length,
    warning: ordered.filter((item) => item.severity === "warning").length,
    info: ordered.filter((item) => item.severity === "info").length,
    late: ordered.filter((item) => item.kind === "late").length,
    unassigned: ordered.filter((item) => item.kind === "unassigned").length,
    stale: ordered.filter((item) => item.kind === "stale_gps").length,
    offRoute: ordered.filter((item) => item.kind === "off_route" || item.kind === "no_route").length,
  };
  return { items: ordered, summary };
}




