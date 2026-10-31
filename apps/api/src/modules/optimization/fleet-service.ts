/**
 * Fleet-wide optimisation (docs/10): one VROOM solve over all eligible
 * vehicles and pending shipments, persisted as a proposal; approval
 * publishes every affected route in one transaction against the current
 * fleet version, or publishes nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  FleetOptimizationProposal,
  GeoPoint,
  LiveProposalStop,
} from "@privatefleet/contracts";
import { EVENT_SCHEMA_VERSION } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";
import {
  planFleet,
  type ShipmentInput,
  type SingleJobInput,
  type VehicleInput,
} from "../routing/plan.js";
import type { RoutingClients } from "../routing/types.js";
import { OptimizationError } from "./service.js";
import { buildRoutePlan } from "./route-plan.js";
import { DISPATCH_LIMITS } from "./dispatch-policy.js";

const ENGINE = "osrm+vroom";
const ENGINE_VERSION = "2";
const DATASET_VERSION = process.env.ROUTING_DATASET_ID ?? "unconfigured";

interface FleetRouteRecord {
  driverId: string;
  vehicleId: string;
  driverName: string;
  stops: LiveProposalStop[];
  geometry: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
  jobIds: string[];
  legs?: Array<{ points: GeoPoint[]; distanceMetres: number; durationSeconds: number }>;
  stopArrivals?: Array<number | undefined>;
}

interface FleetStoredResult {
  kind: "fleet";
  scope: "fleet" | "subset";
  expectedRouteVersion: number;
  datasetVersion: string;
  engineVersion: string;
  matrixSize: number;
  vehicleCount: number;
  shipmentCount: number;
  singleStopJobCount: number;
  totalDistanceMetres: number;
  totalDurationSeconds: number;
  inputHash: string;
  vehicles: FleetRouteRecord[];
  unassigned: Array<{ jobId: string; reason?: string }>;
  assignments: Array<{ jobId: string; driverId: string | null; status: string }>;
  published?: { version: number; routeIds: string[]; publishedAt: string };
  baseline?: {
    routeCount: number;
    assignedStops: number;
    distanceMetres: number;
    durationSeconds: number;
    unassignedJobs: number;
  };
  gate?: { allowed: boolean; reasons: string[] };
}

interface DriverVehicleRow {
  driver_id: string;
  full_name: string;
  vehicle_id: string;
  capacity_units: number | null;
  required_capabilities: string[] | null;
  latitude: number | null;
  longitude: number | null;
}

interface EligibleStopRow {
  job_id: string;
  reference: string;
  status: string;
  assigned_driver_id: string | null;
  stop_id: string;
  stop_type: "pickup" | "dropoff";
  sequence: number;
  address: string;
  latitude: number;
  longitude: number;
  window_start: Date | string;
  window_end: Date | string;
  required_capabilities: string[] | null;
  service_seconds: number | null;
}

interface JobGroup {
  jobId: string;
  reference: string;
  status: string;
  assignedDriverId: string | null;
  pickup?: EligibleStopRow;
  dropoff?: EligibleStopRow;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function inList(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface FleetProposalOptions {
  driverIds?: string[];
}

export async function createFleetProposal(
  handle: DbHandle,
  clients: RoutingClients,
  tenantId: string,
  options: FleetProposalOptions = {},
): Promise<FleetOptimizationProposal> {
  return withTenant(handle, tenantId, async (db) => {
    const versionRows = (await db.execute(sql`
      SELECT coalesce(max(version), 1) AS current
      FROM routes WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')
    `)) as unknown as Array<{ current: number }>;
    const expectedRouteVersion = Number(versionRows[0]?.current ?? 1);

    const selected = options.driverIds?.length ? options.driverIds : null;
    const vehicleRows = (await db.execute(sql`
      SELECT d.id AS driver_id, d.full_name, v.id AS vehicle_id,
             v.capacity_units, v.required_capabilities, v.latitude, v.longitude
      FROM drivers d
      JOIN vehicles v ON v.id = d.vehicle_id
      ${selected ? sql`WHERE d.id IN (${inList(selected)})` : sql``}
      ORDER BY d.full_name
    `)) as unknown as DriverVehicleRow[];

    const stopRows = (await db.execute(sql`
      SELECT j.id AS job_id, j.reference, j.status, j.assigned_driver_id,
             js.id AS stop_id, js.stop_type, js.sequence, js.address,
             js.latitude, js.longitude, js.window_start, js.window_end,
             j.required_capabilities, j.service_seconds
      FROM jobs j
      JOIN job_stops js ON js.job_id = j.id
      WHERE j.status IN ('unassigned', 'assigned')
        AND js.status = 'pending'
        ${selected ? sql`AND (j.assigned_driver_id IS NULL OR j.assigned_driver_id IN (${inList(selected)}))` : sql``}
      ORDER BY j.reference, js.sequence
    `)) as unknown as EligibleStopRow[];

    const jobs = new Map<string, JobGroup>();
    for (const row of stopRows) {
      const group: JobGroup = jobs.get(row.job_id) ?? {
        jobId: row.job_id,
        reference: row.reference,
        status: row.status,
        assignedDriverId: row.assigned_driver_id,
      };
      if (row.stop_type === "pickup") {
        group.pickup = row;
      } else {
        group.dropoff = row;
      }
      jobs.set(row.job_id, group);
    }

    const unassigned: Array<{ jobId: string; reason?: string }> = [];
    const paired: JobGroup[] = [];
    const singleStop: JobGroup[] = [];
    for (const group of jobs.values()) {
      if (group.pickup && group.dropoff) {
        paired.push(group);
      } else if (group.pickup ?? group.dropoff) {
        // A legitimate single-stop service job, not malformed work.
        singleStop.push(group);
      } else {
        unassigned.push({ jobId: group.jobId, reason: "MISSING_STOP" });
      }
    }
    if (paired.length === 0 && singleStop.length === 0) {
      throw new OptimizationError("NO_ASSIGNED_STOPS");
    }

    // Capacity constraints are enforced only when every selected vehicle has
    // a defined capacity; partial configuration is rejected rather than
    // silently ignored.
    const anyCapacity = vehicleRows.some((row) => row.capacity_units !== null);
    const allCapacity = vehicleRows.every((row) => row.capacity_units !== null);
    if (anyCapacity && !allCapacity) {
      throw new OptimizationError("CONSTRAINTS_INCOMPLETE");
    }
    const capacityMode = allCapacity && vehicleRows.length > 0;

    // VROOM cannot enforce skills on paired shipments (it rejects skills
    // there), so paired work requiring capabilities is only planned when
    // every candidate vehicle has them; otherwise it is explicitly
    // unassigned instead of risking an invalid assignment.
    const vehicleSkills = vehicleRows.map((row) => row.required_capabilities ?? []);
    const hasSkillOnEveryVehicle = (required: string[]): boolean =>
      required.every((skill) => vehicleSkills.every((skills) => skills.includes(skill)));

    const pairedEligible: JobGroup[] = [];
    for (const group of paired) {
      const required = group.pickup!.required_capabilities ?? [];
      if (required.length > 0 && !hasSkillOnEveryVehicle(required)) {
        unassigned.push({ jobId: group.jobId, reason: "MISSING_SKILL" });
      } else if (capacityMode && Math.max(...vehicleRows.map((row) => row.capacity_units ?? 0)) < 1) {
        unassigned.push({ jobId: group.jobId, reason: "CAPACITY_EXCEEDED" });
      } else {
        pairedEligible.push(group);
      }
    }
    if (pairedEligible.length === 0 && singleStop.length === 0) {
      throw new OptimizationError("PLAN_INFEASIBLE");
    }

    const shipments: ShipmentInput[] = pairedEligible.map((group) => ({
      id: group.jobId,
      pickup: {
        latitude: Number(group.pickup!.latitude),
        longitude: Number(group.pickup!.longitude),
      },
      dropoff: {
        latitude: Number(group.dropoff!.latitude),
        longitude: Number(group.dropoff!.longitude),
      },
      pickupWindow: [iso(group.pickup!.window_start), iso(group.pickup!.window_end)],
      deliveryWindow: [iso(group.dropoff!.window_start), iso(group.dropoff!.window_end)],
    }));

    const singleJobs: SingleJobInput[] = singleStop.map((group) => {
      const stop = (group.pickup ?? group.dropoff)!;
      return {
        id: group.jobId,
        location: { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
        ...(stop.service_seconds !== null ? { serviceSeconds: stop.service_seconds } : {}),
        timeWindow: [iso(stop.window_start), iso(stop.window_end)],
        ...(stop.required_capabilities?.length
          ? { skills: stop.required_capabilities }
          : {}),
        ...(capacityMode ? { amount: [1] } : {}),
      };
    });

    // Depot: current vehicle position, else the first pending pickup of a job
    // currently assigned to that driver. Vehicles with neither are excluded.
    const firstPickupByDriver = new Map<string, GeoPoint>();
    for (const group of [...paired, ...singleStop]) {
      const stop = group.pickup ?? group.dropoff;
      if (group.assignedDriverId && stop) {
        if (!firstPickupByDriver.has(group.assignedDriverId)) {
          firstPickupByDriver.set(group.assignedDriverId, {
            latitude: Number(stop.latitude),
            longitude: Number(stop.longitude),
          });
        }
      }
    }

    const vehicles: VehicleInput[] = [];
    const vehicleMeta = new Map<
      number,
      { driverId: string; vehicleId: string; driverName: string }
    >();
    for (const [index, row] of vehicleRows.entries()) {
      const depot: GeoPoint | undefined =
        row.latitude !== null && row.longitude !== null
          ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
          : firstPickupByDriver.get(row.driver_id);
      if (!depot) {
        continue;
      }
      const id = index;
      vehicles.push({
        id,
        depot,
        ...(capacityMode ? { capacity: [row.capacity_units ?? 0] } : {}),
        ...(row.required_capabilities?.length
          ? { skills: row.required_capabilities }
          : {}),
        maxDistance: DISPATCH_LIMITS.maxRouteDistanceM,
        maxTravelTime: DISPATCH_LIMITS.maxRouteTravelTimeS,
        maxTasks: DISPATCH_LIMITS.maxRouteTasks,
      });
      vehicleMeta.set(id, {
        driverId: row.driver_id,
        vehicleId: row.vehicle_id,
        driverName: row.full_name,
      });
    }
    if (vehicles.length === 0) {
      throw new OptimizationError("NO_ASSIGNED_STOPS");
    }

    const request = {
      engine: ENGINE,
      engineVersion: ENGINE_VERSION,
      datasetVersion: DATASET_VERSION,
      // Bump when persisted fleet-result semantics change; old cached results
      // must never be served as valid proposals.
      resultSchemaVersion: 5,
      scope: selected ? "subset" : "fleet",
      expectedRouteVersion,
      vehicles,
      shipments,
      jobs: singleJobs,
      constraints: {
        capacityMode,
        singleStopJobCount: singleJobs.length,
      },
      // Assignment state is part of cache identity: a reassigned job must
      // not reuse an older proposal.
      assignments: [...pairedEligible, ...singleStop].map((group) => ({
        jobId: group.jobId,
        driverId: group.assignedDriverId,
        status: group.status,
      })),
    };
    const inputHash = hash(request);

    const cached = (await db.execute(sql`
      SELECT id, result FROM optimization_runs
      WHERE tenant_id = ${tenantId} AND input_hash = ${inputHash}
        AND status = 'succeeded' AND result->>'kind' = 'fleet'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Array<{ id: string; result: FleetStoredResult | null }>;
    if (cached[0]?.result) {
      // Cached proposals are untrusted input too: they must satisfy the same
      // completeness rules before they can be returned or approved.
      assertFleetResultComplete(cached[0].result);
      return fleetProposal(cached[0].id, cached[0].result);
    }

    const plan = await planFleet(clients, { vehicles, shipments, jobs: singleJobs });

    const routes: FleetRouteRecord[] = [];
    for (const planned of plan.vehicles) {
      const meta = vehicleMeta.get(planned.vehicleId);
      if (!meta) {
        throw new OptimizationError("PLAN_INFEASIBLE");
      }
      const stops: LiveProposalStop[] = [];
      let arrivalIndex = 0;
      for (const unit of planned.orderedUnits) {
        if (unit.kind === "shipment") {
          const group = pairedEligible.find((candidate) => candidate.jobId === unit.id);
          if (!group?.pickup || !group.dropoff) {
            throw new OptimizationError("PLAN_INFEASIBLE");
          }
          const pickupArrival = planned.stopArrivals[arrivalIndex];
          const deliveryArrival = planned.stopArrivals[arrivalIndex + 1];
          stops.push(
            {
              jobId: unit.id,
              jobRef: group.reference,
              stopId: group.pickup.stop_id,
              stopType: "pickup",
              address: group.pickup.address,
              ...(pickupArrival && pickupArrival > 1_000_000_000
                ? { arrivalAt: new Date(pickupArrival * 1000).toISOString() }
                : {}),
            },
            {
              jobId: unit.id,
              jobRef: group.reference,
              stopId: group.dropoff.stop_id,
              stopType: "dropoff",
              address: group.dropoff.address,
              ...(deliveryArrival && deliveryArrival > 1_000_000_000
                ? { arrivalAt: new Date(deliveryArrival * 1000).toISOString() }
                : {}),
            },
          );
          arrivalIndex += 2;
        } else {
          const group = singleStop.find((candidate) => candidate.jobId === unit.id);
          const stop = group?.pickup ?? group?.dropoff;
          if (!group || !stop) {
            throw new OptimizationError("PLAN_INFEASIBLE");
          }
          const arrival = planned.stopArrivals[arrivalIndex];
          stops.push({
            jobId: unit.id,
            jobRef: group.reference,
            stopId: stop.stop_id,
            stopType: "service",
            address: stop.address,
            ...(arrival && arrival > 1_000_000_000
              ? { arrivalAt: new Date(arrival * 1000).toISOString() }
              : {}),
          });
          arrivalIndex += 1;
        }
      }
      routes.push({
        ...meta,
        stops,
        geometry: planned.geometry,
        distanceMetres: planned.distanceMetres,
        durationSeconds: planned.durationSeconds,
        jobIds: planned.orderedUnits.map((unit) => unit.id),
        ...(planned.legs ? { legs: planned.legs } : {}),
        stopArrivals: planned.stopArrivals,
      });
    }

    const stored: FleetStoredResult = {
      kind: "fleet",
      scope: selected ? "subset" : "fleet",
      expectedRouteVersion,
      datasetVersion: DATASET_VERSION,
      engineVersion: ENGINE_VERSION,
      matrixSize: plan.matrixSize,
      vehicleCount: vehicles.length,
      shipmentCount: shipments.length,
      singleStopJobCount: singleJobs.length,
      totalDistanceMetres: routes.reduce((sum, route) => sum + route.distanceMetres, 0),
      totalDurationSeconds: routes.reduce((sum, route) => sum + route.durationSeconds, 0),
      inputHash,
      vehicles: routes,
      unassigned: [
        ...unassigned,
        ...plan.unassigned.map((jobId) => ({
          jobId,
          reason: plan.unassignedReasons.get(jobId) ?? "SOLVER_UNASSIGNED",
        })),
      ],
      assignments: [...pairedEligible, ...singleStop].map((group) => ({
        jobId: group.jobId,
        driverId: group.assignedDriverId,
        status: group.status,
      })),
    };

    const baselineRows = (await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM routes
          WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')) AS route_count,
        (SELECT count(*)::int FROM route_stops rs
          JOIN routes r ON r.id = rs.route_id
          WHERE r.tenant_id = ${tenantId} AND r.status IN ('published', 'in_progress')) AS assigned_stops,
        (SELECT coalesce(sum(planned_distance_m), 0)::float FROM routes
          WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')) AS distance,
        (SELECT coalesce(sum(planned_duration_s), 0)::float FROM routes
          WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')) AS duration,
        (SELECT count(*)::int FROM jobs
          WHERE tenant_id = ${tenantId} AND status = 'unassigned') AS unassigned_jobs
    `)) as unknown as Array<{
      route_count: number;
      assigned_stops: number;
      distance: number;
      duration: number;
      unassigned_jobs: number;
    }>;
    const base = baselineRows[0] ?? {
      route_count: 0,
      assigned_stops: 0,
      distance: 0,
      duration: 0,
      unassigned_jobs: 0,
    };
    const proposalStops = routes.reduce((sum, route) => sum + route.stops.length, 0);
    const reasons: string[] = [];
    if (proposalStops < Number(base.assigned_stops)) {
      reasons.push(
        `Proposal assigns ${proposalStops} stops, fewer than the current ${base.assigned_stops}.`,
      );
    }
    if (stored.unassigned.length > Number(base.unassigned_jobs)) {
      reasons.push(
        `Proposal leaves ${stored.unassigned.length} jobs unassigned; baseline has ${base.unassigned_jobs}.`,
      );
    }
    for (const route of routes) {
      if (route.distanceMetres > DISPATCH_LIMITS.maxRouteDistanceM) {
        reasons.push(
          `${route.driverName}: route ${Math.round(route.distanceMetres / 1000)} km exceeds the ${Math.round(DISPATCH_LIMITS.maxRouteDistanceM / 1000)} km limit.`,
        );
      }
      if (route.stops.length > DISPATCH_LIMITS.maxRouteTasks) {
        reasons.push(
          `${route.driverName}: ${route.stops.length} visits exceed the ${DISPATCH_LIMITS.maxRouteTasks} stop limit.`,
        );
      }
      if (route.durationSeconds > DISPATCH_LIMITS.maxRouteTravelTimeS) {
        reasons.push(
          `${route.driverName}: route travel time exceeds the limit.`,
        );
      }
    }
    if (
      stored.shipmentCount <= Number(base.assigned_stops) &&
      stored.totalDistanceMetres > Number(base.distance) * 1.02
    ) {
      reasons.push(
        `Proposal distance ${Math.round(stored.totalDistanceMetres)} m is worse than baseline ${Math.round(Number(base.distance))} m.`,
      );
    }
    stored.baseline = {
      routeCount: Number(base.route_count),
      assignedStops: Number(base.assigned_stops),
      distanceMetres: Number(base.distance),
      durationSeconds: Number(base.duration),
      unassignedJobs: Number(base.unassigned_jobs),
    };
    stored.gate = { allowed: reasons.length === 0, reasons };

    const inserted = (await db.execute(sql`
      INSERT INTO optimization_runs
        (tenant_id, input_hash, engine, engine_version, request, result, metrics,
         status, started_at, finished_at)
      VALUES
        (${tenantId}, ${inputHash}, ${ENGINE}, ${ENGINE_VERSION},
         ${JSON.stringify(request)}::jsonb, ${JSON.stringify(stored)}::jsonb,
         ${JSON.stringify({
           vehicleCount: stored.vehicleCount,
           shipmentCount: stored.shipmentCount,
           matrixSize: stored.matrixSize,
           distanceMetres: routes.reduce((sum, route) => sum + route.distanceMetres, 0),
           durationSeconds: routes.reduce((sum, route) => sum + route.durationSeconds, 0),
           unassignedCount: stored.unassigned.length,
           matrixMs: plan.timings.matrixMs,
           solveMs: plan.timings.solveMs,
           geometryMs: plan.timings.geometryMs,
         })}::jsonb,
         'succeeded', now(), now())
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const runId = inserted[0]?.id;
    if (!runId) {
      throw new OptimizationError("RUN_NOT_READY");
    }
    return fleetProposal(runId, stored);
  });
}

/**
 * Validate a persisted fleet result. Every stop identity must be coherent:
 * service jobs exactly once, paired shipments exactly one pickup and one
 * delivery on the same route, no duplicates or contradictions, and totals
 * consistent with the routes. Throws ROUTING_INVALID_RESPONSE.
 */
export function assertFleetResultComplete(result: FleetStoredResult): void {
  const serviceStops = result.vehicles.flatMap((route) =>
    route.stops.filter((stop) => stop.stopType === "service"),
  );
  if (serviceStops.length !== result.singleStopJobCount) {
    throw new OptimizationError(
      "ROUTING_INVALID_RESPONSE",
      "cached result service stops do not match single-stop job count",
    );
  }
  const pickupStops = result.vehicles.flatMap((route) =>
    route.stops.filter((stop) => stop.stopType === "pickup"),
  );
  if (pickupStops.length !== result.shipmentCount) {
    throw new OptimizationError(
      "ROUTING_INVALID_RESPONSE",
      "cached result pickup stops do not match shipment count",
    );
  }
  const seenStops = new Set<string>();
  for (const route of result.vehicles) {
    const byJob = new Map<string, { pickup: number; dropoff: number; service: number }>();
    for (const stop of route.stops) {
      if (seenStops.has(stop.stopId)) {
        throw new OptimizationError("ROUTING_INVALID_RESPONSE", "duplicate stop identity");
      }
      seenStops.add(stop.stopId);
      const counts = byJob.get(stop.jobId) ?? { pickup: 0, dropoff: 0, service: 0 };
      counts[stop.stopType] += 1;
      byJob.set(stop.jobId, counts);
    }
    for (const [jobId, counts] of byJob) {
      const isService = counts.service > 0;
      const isPaired = counts.pickup > 0 || counts.dropoff > 0;
      if (isService && isPaired) {
        throw new OptimizationError(
          "ROUTING_INVALID_RESPONSE",
          "job " + jobId + " is both a service stop and a shipment",
        );
      }
      if (isService && counts.service !== 1) {
        throw new OptimizationError("ROUTING_INVALID_RESPONSE", "duplicate service stop");
      }
      if (isPaired && (counts.pickup !== 1 || counts.dropoff !== 1)) {
        throw new OptimizationError(
          "ROUTING_INVALID_RESPONSE",
          "shipment " + jobId + " needs one pickup and one delivery on the same route",
        );
      }
    }
  }
  const unassignedIds = new Set<string>();
  for (const entry of result.unassigned) {
    if (unassignedIds.has(entry.jobId)) {
      throw new OptimizationError("ROUTING_INVALID_RESPONSE", "duplicate unassigned job");
    }
    unassignedIds.add(entry.jobId);
    if (result.vehicles.some((route) => route.jobIds.includes(entry.jobId))) {
      throw new OptimizationError(
        "ROUTING_INVALID_RESPONSE",
        "job is both assigned and unassigned",
      );
    }
  }
  const distance = result.vehicles.reduce((sum, route) => sum + route.distanceMetres, 0);
  const duration = result.vehicles.reduce((sum, route) => sum + route.durationSeconds, 0);
  if (Math.abs(distance - result.totalDistanceMetres) > 0.01) {
    throw new OptimizationError("ROUTING_INVALID_RESPONSE", "cached distance totals mismatch");
  }
  if (Math.abs(duration - result.totalDurationSeconds) > 0.01) {
    throw new OptimizationError("ROUTING_INVALID_RESPONSE", "cached duration totals mismatch");
  }
}

function fleetProposal(runId: string, result: FleetStoredResult): FleetOptimizationProposal {
  return {
    runId,
    demoMode: false,
    engine: ENGINE,
    engineVersion: result.engineVersion,
    status: "succeeded",
    scope: result.scope,
    published: Boolean(result.published),
    ...(result.published ? { publishedAt: result.published.publishedAt } : {}),
    ...(result.published ? { publishedVersion: result.published.version } : {}),
    inputHash: result.inputHash,
    expectedRouteVersion: result.expectedRouteVersion,
    matrixSize: result.matrixSize,
    vehicleCount: result.vehicleCount,
    shipmentCount: result.shipmentCount,
    singleStopJobCount: result.singleStopJobCount,
    totalDistanceMetres: result.totalDistanceMetres,
    totalDurationSeconds: result.totalDurationSeconds,
    vehicles: result.vehicles.map((route) => ({
      driverId: route.driverId,
      vehicleId: route.vehicleId,
      driverName: route.driverName,
      stops: route.stops,
      geometry: route.geometry,
      distanceMetres: route.distanceMetres,
      durationSeconds: route.durationSeconds,
    })),
    unassigned: result.unassigned,
    datasetVersion: result.datasetVersion,
    ...(result.baseline ? { baseline: result.baseline } : {}),
    ...(result.gate ? { gate: result.gate } : {}),
  };
}

export interface FleetApprovalResult {
  version: number;
  routeIds: string[];
  publishedAt: string;
}

export async function approveFleetProposal(
  handle: DbHandle,
  tenantId: string,
  runId: string,
  expectedRouteVersion?: number,
): Promise<FleetApprovalResult> {
  return withTenant(handle, tenantId, async (db) => {
    const runs = (await db.execute(sql`
      SELECT id, result FROM optimization_runs
      WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'succeeded'
      FOR UPDATE
    `)) as unknown as Array<{ id: string; result: FleetStoredResult | null }>;
    const run = runs[0];
    if (!run?.result || run.result.kind !== "fleet") {
      throw new OptimizationError("RUN_NOT_FOUND");
    }
    const stored = run.result;
    if (stored.published) {
      return {
        version: stored.published.version,
        routeIds: stored.published.routeIds,
        publishedAt: stored.published.publishedAt,
      };
    }

    const versionRows = (await db.execute(sql`
      SELECT coalesce(max(version), 1) AS current
      FROM routes WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')
    `)) as unknown as Array<{ current: number }>;
    const current = Number(versionRows[0]?.current ?? 1);
    const expected = expectedRouteVersion ?? stored.expectedRouteVersion;
    if (expected !== current) {
      throw new OptimizationError("ROUTE_VERSION_STALE");
    }

    // The assignment state must still match what the solver saw.
    const jobIds = stored.assignments.map((entry) => entry.jobId);
    const currentRows = (await db.execute(sql`
      SELECT id, assigned_driver_id, status FROM jobs
      WHERE tenant_id = ${tenantId} AND id IN (${inList(jobIds)})
    `)) as unknown as Array<{
      id: string;
      assigned_driver_id: string | null;
      status: string;
    }>;
    const currentById = new Map(currentRows.map((row) => [row.id, row]));
    for (const snapshot of stored.assignments) {
      const now = currentById.get(snapshot.jobId);
      if (!now || now.assigned_driver_id !== snapshot.driverId || now.status !== snapshot.status) {
        throw new OptimizationError("ROUTE_VERSION_STALE");
      }
    }

    const nextVersion = current + 1;
    const publishedAt = new Date().toISOString();
    const routeIds: string[] = [];
    const vehicleIds = stored.vehicles.map((route) => route.vehicleId);

    await db.execute(sql`
      UPDATE routes SET status = 'superseded'
      WHERE tenant_id = ${tenantId} AND status = 'published'
        AND vehicle_id IN (${inList(vehicleIds)})
    `);

    for (const route of stored.vehicles) {
      const plan = buildRoutePlan({
        geometry: route.geometry,
        legs: route.legs,
        stops: route.stops.map((stop) => ({
          stopId: stop.stopId,
          jobId: stop.jobId,
          stopType: stop.stopType,
        })),
        stopArrivals: route.stopArrivals,
      });
      await db.execute(sql`
        INSERT INTO routes
          (id, tenant_id, route_date, driver_id, vehicle_id, status, version,
           planned_distance_m, planned_duration_s, geometry, waypoints, legs, published_at)
        VALUES
          (${plan.routeId}, ${tenantId}, current_date, ${route.driverId}, ${route.vehicleId}, 'published',
           ${nextVersion}, ${Math.round(route.distanceMetres)}, ${Math.round(route.durationSeconds)},
           ${JSON.stringify(route.geometry)}::jsonb,
           ${JSON.stringify(plan.waypoints)}::jsonb,
           ${JSON.stringify(plan.legs)}::jsonb, now())
      `);
      const routeId = plan.routeId;
      routeIds.push(routeId);

      for (const [index, stop] of route.stops.entries()) {
        await db.execute(sql`
          INSERT INTO route_stops
            (tenant_id, route_id, job_stop_id, sequence_no, planned_arrival_at)
          VALUES
            (${tenantId}, ${routeId}, ${stop.stopId}, ${index + 1},
             ${route.stopArrivals?.[index]
               ? new Date(route.stopArrivals[index]! * 1000).toISOString()
               : null})
        `);
      }

      for (const jobId of route.jobIds) {
        await db.execute(sql`
          UPDATE jobs
          SET assigned_driver_id = ${route.driverId},
              assigned_vehicle_id = ${route.vehicleId},
              status = CASE WHEN status = 'unassigned' THEN 'assigned'::job_status ELSE status END
          WHERE tenant_id = ${tenantId} AND id = ${jobId}
        `);
      }

      const envelope = {
        eventId: randomUUID(),
        schemaVersion: EVENT_SCHEMA_VERSION,
        tenantId,
        aggregateType: "route",
        aggregateId: routeId,
        type: "route.published",
        occurredAt: publishedAt,
        payload: {
          routeId,
          version: nextVersion,
          driverId: route.driverId,
          distanceMetres: route.distanceMetres,
          durationSeconds: route.durationSeconds,
          fleetPlan: true,
        },
      };
      await db.execute(sql`
        INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES (${tenantId}, 'route', ${routeId}, 'route.published', ${JSON.stringify(envelope)}::jsonb)
      `);
    }

    const publishedResult: FleetStoredResult = {
      ...stored,
      published: { version: nextVersion, routeIds, publishedAt },
    };
    await db.execute(sql`
      UPDATE optimization_runs
      SET route_ids = ${JSON.stringify(routeIds)}::jsonb,
          result = ${JSON.stringify(publishedResult)}::jsonb,
          finished_at = now()
      WHERE id = ${runId}
    `);

    return { version: nextVersion, routeIds, publishedAt };
  });
}

// Keep the type import referenced for consumers of this module.
export type { FleetStoredResult };












