/**
 * Validated planning pipeline (docs/10.2): OSRM matrix -> VROOM solve ->
 * OSRM road geometry for the exact solved order -> invariant checks.
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

function windows(
  window: [string, string] | undefined,
): [number, number] | undefined {
  return window ? [epochSeconds(window[0]), epochSeconds(window[1])] : undefined;
}

export async function planShipments(
  clients: RoutingClients,
  request: PlanRequest,
): Promise<PlanResult> {
  const { vehicle, shipments } = request;
  if (shipments.length === 0) {
    return { vehicles: [], unassigned: [], matrixSize: 0 };
  }

  const points: GeoPoint[] = [{ ...vehicle.depot }];
  for (const shipment of shipments) {
    points.push({ ...shipment.pickup }, { ...shipment.dropoff });
  }

  const matrices: OsrmMatrix = await clients.matrix(points);

  const vroomVehicle: VroomVehicleInput = {
    id: vehicle.id,
    startIndex: 0,
    endIndex: 0,
  };
  if (vehicle.capacity) {
    vroomVehicle.capacity = vehicle.capacity;
  }
  const vehicleWindow = windows(vehicle.timeWindow);
  if (vehicleWindow) {
    vroomVehicle.timeWindow = vehicleWindow;
  }

  const vroomShipments: VroomShipmentInput[] = shipments.map((shipment, index) => {
    const entry: VroomShipmentInput = {
      id: shipment.id,
      pickupIndex: 1 + index * 2,
      deliveryIndex: 2 + index * 2,
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

  const solution = await clients.solve(vroomVehicleList(vroomVehicle), vroomShipments, matrices, points.length);

  const byId = new Map(shipments.map((shipment) => [shipment.id, shipment]));
  const planned: PlannedVehicle[] = [];
  for (const route of solution.routes) {
    const orderedShipmentIds = solution.orderByVehicle.get(route.vehicleId) ?? [];
    if (orderedShipmentIds.length === 0) {
      continue;
    }
    const coordinates: GeoPoint[] = [{ ...vehicle.depot }];
    for (const id of orderedShipmentIds) {
      const shipment = byId.get(id);
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

  return { vehicles: planned, unassigned: solution.unassigned, matrixSize: points.length };
}

function vroomVehicleList(vehicle: VroomVehicleInput): VroomVehicleInput[] {
  return [vehicle];
}
