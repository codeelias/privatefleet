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
}

export interface PlanResult {
  vehicles: PlannedVehicle[];
  unassigned: string[];
  /** Solver-provided descriptions keyed by business id. */
  unassignedReasons: Map<string, string>;
  matrixSize: number;
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
    };
  }
  if (vehicles.length === 0) {
    throw new RoutingError("PLAN_INFEASIBLE", "no eligible vehicles");
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

  const matrices: OsrmMatrix = await clients.matrix(locator.locations);

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

  const solution = await clients.solve(
    vroomVehicles,
    vroomShipments,
    matrices,
    locator.locations.length,
    vroomJobs,
  );

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
    });
  }

  if (planned.length === 0 && solution.unassigned.length === 0) {
    throw new RoutingError("PLAN_INFEASIBLE", "solver produced no plan");
  }

  return {
    vehicles: planned,
    unassigned: solution.unassigned,
    unassignedReasons: solution.unassignedReasons,
    matrixSize: locator.locations.length,
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
