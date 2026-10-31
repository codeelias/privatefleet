/**
 * Validated planning pipeline (docs/10.2): OSRM matrix -> VROOM solve ->
 * OSRM road geometry for the exact solved order -> invariant checks.
 * Supports paired shipments and single-stop jobs on one or many vehicles.
 * Unassigned work is surfaced, never silently dropped.
 */
import type { GeoPoint } from "@privatefleet/contracts";
import {
  RoutingError,
  validateGeometry,
  type OsrmMatrix,
  type RoutingClients,
  type VroomJobInput,
  type VroomShipmentInput,
  type VroomUnitRef,
  type VroomVehicleInput,
} from "./types.js";

export interface ShipmentInput {
  id: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  pickupServiceSeconds?: number;
  deliveryServiceSeconds?: number;
  pickupWindow?: [string, string];
  deliveryWindow?: [string, string];
}

export interface SingleJobInput {
  id: string;
  location: GeoPoint;
  serviceSeconds?: number;
  timeWindow?: [string, string];
  skills?: string[];
  amount?: number[];
}

export interface VehicleInput {
  id: number;
  depot: GeoPoint;
  capacity?: number[];
  timeWindow?: [string, string];
  skills?: string[];
  maxDistance?: number;
  maxTravelTime?: number;
  maxTasks?: number;
}

export interface PlanRequest {
  vehicle: VehicleInput;
  shipments: ShipmentInput[];
}

export interface FleetPlanRequest {
  vehicles: VehicleInput[];
  shipments: ShipmentInput[];
  jobs?: SingleJobInput[];
}

export interface PlannedVehicle {
  vehicleId: number;
  orderedShipmentIds: string[];
  orderedUnits: VroomUnitRef[];
  /** Arrival seconds per expanded stop (shipment pickup, delivery, job). */
  stopArrivals: Array<number | undefined>;
  geometry: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
  /** Waypoint-bounded legs from the routing engine (one per adjacent stop). */
  legs?: Array<{ points: GeoPoint[]; distanceMetres: number; durationSeconds: number }>;
}

export interface PlanResult {
  vehicles: PlannedVehicle[];
  unassigned: string[];
  /** Solver-provided descriptions keyed by business id. */
  unassignedReasons: Map<string, string>;
  matrixSize: number;
  timings: { matrixMs: number; solveMs: number; geometryMs: number };
}

function epochSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new RoutingError("ROUTING_INVALID_RESPONSE", "invalid time window");
  }
  return Math.floor(ms / 1000);
}

function windows(window: [string, string] | undefined): [number, number] | undefined {
  return window ? [epochSeconds(window[0]), epochSeconds(window[1])] : undefined;
}

interface LocationIndex {
  locations: GeoPoint[];
  indexOf: (point: GeoPoint) => number;
}

function locationIndexer(): LocationIndex {
  const locations: GeoPoint[] = [];
  const indexByKey = new Map<string, number>();
  const indexOf = (point: GeoPoint): number => {
    const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const index = locations.length;
    locations.push({ ...point });
    indexByKey.set(key, index);
    return index;
  };
  return { locations, indexOf };
}

/**
 * Solve vehicles against a shared pool of shipments and single-stop jobs.
 * Matrix locations are deduplicated because VROOM rejects zero
 * off-diagonal entries for repeated coordinates.
 */
export async function planFleet(
  clients: RoutingClients,
  request: FleetPlanRequest,
): Promise<PlanResult> {
  const { vehicles, shipments } = request;
  const jobs = request.jobs ?? [];
  if (shipments.length === 0 && jobs.length === 0) {
    return {
      vehicles: [],
      unassigned: [],
      unassignedReasons: new Map(),
      matrixSize: 0,
      timings: { matrixMs: 0, solveMs: 0, geometryMs: 0 },
    };
  }
  if (vehicles.length === 0) {
    throw new RoutingError("PLAN_INFEASIBLE", "no eligible vehicles");
  }

  // VROOM rejects queries above its configured location/task ceiling. Fail
  // before allocating a matrix or making an unbounded external call.
  const solverTasks = shipments.length * 2 + jobs.length;
  const maxTasks = Number(process.env.VROOM_MAX_TASKS ?? 1000);
  if (solverTasks > maxTasks) {
    throw new RoutingError(
      "PLAN_TOO_LARGE",
      "solver would receive " +
        solverTasks +
        " tasks; configured limit is " +
        maxTasks,
    );
  }

  const locator = locationIndexer();
  const depots = new Map<number, number>();
  for (const vehicle of vehicles) {
    depots.set(vehicle.id, locator.indexOf(vehicle.depot));
  }
  const shipmentLocations = shipments.map((shipment) => ({
    pickup: locator.indexOf(shipment.pickup),
    delivery: locator.indexOf(shipment.dropoff),
  }));
  const jobLocations = jobs.map((job) => locator.indexOf(job.location));

  // Hard guard before any external call: a very large matrix can exhaust
  // OSRM memory and hang the request. Distinct deduplicated locations are
  // what matters (jobs at the same address share an index).
  const maxLocations = Number(process.env.ROUTING_MAX_MATRIX_LOCATIONS ?? 100);
  if (locator.locations.length > maxLocations) {
    throw new RoutingError(
      "PLAN_TOO_LARGE",
      "matrix needs " +
        locator.locations.length +
        " distinct locations; configured limit is " +
        maxLocations,
    );
  }

  const matrixStarted = performance.now();
  const matrices: OsrmMatrix = await clients.matrix(locator.locations);
  const matrixMs = performance.now() - matrixStarted;

  const vroomVehicles: VroomVehicleInput[] = vehicles.map((vehicle) => {
    const depotIndex = depots.get(vehicle.id) ?? 0;
    const entry: VroomVehicleInput = {
      id: vehicle.id,
      startIndex: depotIndex,
      endIndex: depotIndex,
    };
    if (vehicle.capacity) {
      entry.capacity = vehicle.capacity;
    }
    const window = windows(vehicle.timeWindow);
    if (window) {
      entry.timeWindow = window;
    }
    if (vehicle.skills?.length) {
      entry.skills = vehicle.skills;
    }
    if (vehicle.maxDistance) entry.maxDistance = vehicle.maxDistance;
    if (vehicle.maxTravelTime) entry.maxTravelTime = vehicle.maxTravelTime;
    if (vehicle.maxTasks) entry.maxTasks = vehicle.maxTasks;
    return entry;
  });

  const vroomShipments: VroomShipmentInput[] = shipments.map((shipment, index) => {
    const entry: VroomShipmentInput = {
      id: shipment.id,
      pickupIndex: shipmentLocations[index]!.pickup,
      deliveryIndex: shipmentLocations[index]!.delivery,
    };
    if (shipment.pickupServiceSeconds !== undefined) {
      entry.pickupServiceSeconds = shipment.pickupServiceSeconds;
    }
    if (shipment.deliveryServiceSeconds !== undefined) {
      entry.deliveryServiceSeconds = shipment.deliveryServiceSeconds;
    }
    const pickupWindow = windows(shipment.pickupWindow);
    if (pickupWindow) {
      entry.pickupWindow = pickupWindow;
    }
    const deliveryWindow = windows(shipment.deliveryWindow);
    if (deliveryWindow) {
      entry.deliveryWindow = deliveryWindow;
    }
    return entry;
  });

  const vroomJobs: VroomJobInput[] = jobs.map((job, index) => {
    const entry: VroomJobInput = { id: job.id, locationIndex: jobLocations[index]! };
    if (job.serviceSeconds !== undefined) {
      entry.serviceSeconds = job.serviceSeconds;
    }
    const window = windows(job.timeWindow);
    if (window) {
      entry.timeWindow = window;
    }
    if (job.skills?.length) {
      entry.skills = job.skills;
    }
    if (job.amount) {
      entry.amount = job.amount;
    }
    return entry;
  });

  const solveStarted = performance.now();
  const solution = await clients.solve(
    vroomVehicles,
    vroomShipments,
    matrices,
    locator.locations.length,
    vroomJobs,
  );
  const solveMs = performance.now() - solveStarted;

  const geometryStarted = performance.now();
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const shipmentById = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const planned: PlannedVehicle[] = [];

  for (const route of solution.routes) {
    const vehicle = vehicleById.get(route.vehicleId);
    if (!vehicle) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "VROOM returned an unknown vehicle");
    }
    const units =
      solution.ordersByVehicle.get(route.vehicleId) ??
      (solution.orderByVehicle.get(route.vehicleId) ?? []).map((id) => ({
        kind: "shipment" as const,
        id,
      }));
    if (units.length === 0) {
      continue;
    }
    const arrivals = solution.arrivalsByVehicle.get(route.vehicleId);
    const coordinates: GeoPoint[] = [{ ...vehicle.depot }];
    const stopArrivals: Array<number | undefined> = [];
    for (const unit of units) {
      if (unit.kind === "shipment") {
        const shipment = shipmentById.get(unit.id);
        if (!shipment) {
          throw new RoutingError("ROUTING_INVALID_RESPONSE", "VROOM returned an unknown shipment");
        }
        coordinates.push({ ...shipment.pickup }, { ...shipment.dropoff });
        stopArrivals.push(
          arrivals?.get(`shipment:${unit.id}:pickup`),
          arrivals?.get(`shipment:${unit.id}:delivery`),
        );
      } else {
        const job = jobById.get(unit.id);
        if (!job) {
          throw new RoutingError("ROUTING_INVALID_RESPONSE", "VROOM returned an unknown job");
        }
        coordinates.push({ ...job.location });
        stopArrivals.push(arrivals?.get(`job:${unit.id}:job`));
      }
    }
    const geometry = await clients.route(coordinates);
    validateGeometry(geometry.points, vehicle.depot);
    planned.push({
      vehicleId: route.vehicleId,
      orderedShipmentIds: units.filter((unit) => unit.kind === "shipment").map((unit) => unit.id),
      orderedUnits: units.map((unit) => ({ ...unit })),
      stopArrivals,
      geometry: geometry.points,
      distanceMetres: geometry.distanceMetres,
      durationSeconds: geometry.durationSeconds,
      ...(geometry.legs ? { legs: geometry.legs } : {}),
    });
  }

  if (planned.length === 0 && solution.unassigned.length === 0) {
    throw new RoutingError("PLAN_INFEASIBLE", "solver produced no plan");
  }

  // Fail closed: every submitted business unit must be accounted for exactly
  // once, either assigned to a route or explicitly unassigned by the solver.
  const submitted = [
    ...shipments.map((shipment) => ({ kind: "shipment" as const, id: shipment.id })),
    ...jobs.map((job) => ({ kind: "job" as const, id: job.id })),
  ];
  const known = new Set(submitted.map((unit) => unit.kind + ":" + unit.id));
  const assigned = new Set<string>();
  for (const route of planned) {
    for (const unit of route.orderedUnits) {
      const key = unit.kind + ":" + unit.id;
      if (!known.has(key)) {
        throw new RoutingError(
          "ROUTING_INVALID_RESPONSE",
          "solver returned an unknown task identity",
        );
      }
      if (assigned.has(key)) {
        throw new RoutingError(
          "ROUTING_INVALID_RESPONSE",
          "solver assigned the same task to more than one route",
        );
      }
      assigned.add(key);
    }
  }
  const unassignedSet = new Set(solution.unassigned);
  for (const unit of submitted) {
    const key = unit.kind + ":" + unit.id;
    const explicitlyUnassigned = unassignedSet.has(unit.id);
    if (!assigned.has(key) && !explicitlyUnassigned) {
      throw new RoutingError(
        "ROUTING_INVALID_RESPONSE",
        "solver omitted a submitted " + unit.kind + " without declaring it unassigned",
      );
    }
    if (assigned.has(key) && explicitlyUnassigned) {
      throw new RoutingError(
        "ROUTING_INVALID_RESPONSE",
        "solver both assigned and unassigned the same task",
      );
    }
  }

  return {
    vehicles: planned,
    unassigned: solution.unassigned,
    unassignedReasons: solution.unassignedReasons,
    matrixSize: locator.locations.length,
    timings: {
      matrixMs: Math.round(matrixMs),
      solveMs: Math.round(solveMs),
      geometryMs: Math.round(performance.now() - geometryStarted),
    },
  };
}

/** Single-vehicle compatibility wrapper used by the original endpoint. */
export async function planShipments(
  clients: RoutingClients,
  request: PlanRequest,
): Promise<PlanResult> {
  return planFleet(clients, {
    vehicles: [request.vehicle],
    shipments: request.shipments,
  });
}



