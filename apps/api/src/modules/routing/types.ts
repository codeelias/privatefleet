/**
 * Routing provider contract (docs/10, docs/16): OSRM supplies matrices and
 * road geometry, VROOM solves assignment/sequence. Both are separate
 * responsibilities behind one validated planner.
 */
import type { GeoPoint } from "@privatefleet/contracts";

export type RoutingErrorCode =
  | "ROUTING_NOT_CONFIGURED"
  | "OSRM_UNAVAILABLE"
  | "VROOM_UNAVAILABLE"
  | "ROUTING_INVALID_RESPONSE"
  | "PLAN_INFEASIBLE"
  | "PLAN_TOO_LARGE";

export class RoutingError extends Error {
  constructor(
    readonly code: RoutingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface OsrmMatrix {
  durations: number[][];
  distances: number[][];
}

export interface OsrmLeg {
  points: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
}

export interface OsrmRoute {
  points: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
  /** One leg per adjacent input coordinate; assembled from OSRM steps. */
  legs?: OsrmLeg[];
}

export interface VroomVehicleInput {
  id: number;
  startIndex: number;
  endIndex: number;
  capacity?: number[];
  timeWindow?: [number, number];
  /** VROOM skills; a job requiring a skill only fits a vehicle with it. */
  skills?: string[];
  /** Hard dispatch limits. */
  maxDistance?: number;
  maxTravelTime?: number;
  maxTasks?: number;
}

export interface VroomJobInput {
  id: string;
  locationIndex: number;
  serviceSeconds?: number;
  timeWindow?: [number, number];
  skills?: string[];
  amount?: number[];
}

export interface VroomShipmentInput {
  id: string;
  pickupIndex: number;
  deliveryIndex: number;
  amount?: number[];
  pickupServiceSeconds?: number;
  deliveryServiceSeconds?: number;
  pickupWindow?: [number, number];
  deliveryWindow?: [number, number];
}

export type VroomUnitRef = {
  kind: "shipment" | "job";
  id: string;
};

export interface VroomSolution {
  /** Ordered shipment ids per vehicle (compatibility view). */
  orderByVehicle: Map<number, string[]>;
  /** Exact solved stop units per vehicle, preserving interleaving. */
  ordersByVehicle: Map<number, VroomUnitRef[]>;
  /** Solver-provided arrival seconds per unit: key "kind:id:role". */
  arrivalsByVehicle: Map<number, Map<string, number>>;
  unassigned: string[];
  /** Solver descriptions for unassigned work, keyed by business id. */
  unassignedReasons: Map<string, string>;
  routes: Array<{ vehicleId: number; distanceMetres: number; durationSeconds: number }>;
}

export interface RoutingClients {
  matrix: (points: GeoPoint[]) => Promise<OsrmMatrix>;
  route: (points: GeoPoint[]) => Promise<OsrmRoute>;
  solve: (
    vehicles: VroomVehicleInput[],
    shipments: VroomShipmentInput[],
    matrices: OsrmMatrix,
    locationCount: number,
    jobs?: VroomJobInput[],
  ) => Promise<VroomSolution>;
}

export function isValidPoint(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

/** Route geometry must be a real, finite LineString starting near the depot. */
export function validateGeometry(points: GeoPoint[], depot: GeoPoint): void {
  if (points.length < 2) {
    throw new RoutingError("ROUTING_INVALID_RESPONSE", "geometry needs at least two points");
  }
  for (const point of points) {
    if (!isValidPoint(point)) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "geometry has invalid coordinates");
    }
  }
  const first = points[0];
  if (!first) {
    throw new RoutingError("ROUTING_INVALID_RESPONSE", "geometry is empty");
  }
  const metres =
    Math.hypot(
      (first.latitude - depot.latitude) * 110_540,
      (first.longitude - depot.longitude) * 111_320 * Math.cos((depot.latitude * Math.PI) / 180),
    ) || 0;
  if (metres > 500) {
    throw new RoutingError("ROUTING_INVALID_RESPONSE", "geometry does not start at the depot");
  }
}

