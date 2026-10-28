/**
 * Validated planning pipeline (docs/10.2): OSRM matrix -> VROOM solve ->
 * OSRM road geometry for the exact solved order -> invariant checks.
 * Supports one vehicle (single-driver) and joint fleet-wide planning.
 * Unassigned work is surfaced, never silently dropped.
 */
import type { GeoPoint } from "@privatefleet/contracts";
import {
  RoutingError,
  validateGeometry,
  type OsrmMatrix,
  type RoutingClients,
  type VroomShipmentInput,
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

export interface VehicleInput {
  id: number;
  depot: GeoPoint;
  capacity?: number[];
  timeWindow?: [string, string];
}

export interface PlanRequest {
  vehicle: VehicleInput;
  shipments: ShipmentInput[];
}

export interface FleetPlanRequest {
  vehicles: VehicleInput[];
  shipments: ShipmentInput[];
}

export interface PlannedVehicle {
  vehicleId: number;
  orderedShipmentIds: string[];
  geometry: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
}

export interface PlanResult {
  vehicles: PlannedVehicle[];
  unassigned: string[];
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
 * Solve one or more vehicles against a shared shipment pool. Matrix
 * locations are deduplicated (same building visited by several shipments)
 * because VROOM rejects zero off-diagonal entries.
 */
export async function planFleet(
  clients: RoutingClients,
  request: FleetPlanRequest,
): Promise<PlanResult> {
  const { vehicles, shipments } = request;
  if (shipments.length === 0) {
    return { vehicles: [], unassigned: [], matrixSize: 0 };
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

  const solution = await clients.solve(
    vroomVehicles,
    vroomShipments,
    matrices,
    locator.locations.length,
  );

  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const shipmentById = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  const planned: PlannedVehicle[] = [];
  for (const route of solution.routes) {
    const orderedShipmentIds = solution.orderByVehicle.get(route.vehicleId) ?? [];
    if (orderedShipmentIds.length === 0) {
      continue;
    }
    const vehicle = vehicleById.get(route.vehicleId);
    if (!vehicle) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "VROOM returned an unknown vehicle");
    }
    const coordinates: GeoPoint[] = [{ ...vehicle.depot }];
    for (const id of orderedShipmentIds) {
      const shipment = shipmentById.get(id);
      if (!shipment) {
        throw new RoutingError("ROUTING_INVALID_RESPONSE", "VROOM returned an unknown shipment");
      }
      coordinates.push({ ...shipment.pickup }, { ...shipment.dropoff });
    }
    const geometry = await clients.route(coordinates);
    validateGeometry(geometry.points, vehicle.depot);
    planned.push({
      vehicleId: route.vehicleId,
      orderedShipmentIds,
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
