/**
 * VROOM HTTP adapter (docs/10.3): shipments (paired pickup/delivery),
 * matrices supplied by OSRM, validated solution output.
 */
import { RoutingError, type OsrmMatrix, type VroomShipmentInput, type VroomSolution, type VroomVehicleInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

interface VroomResponse {
  code?: number;
  error?: string;
  unassigned?: Array<{ id?: string | number }>;
  routes?: Array<{
    vehicle?: number;
    distance?: number;
    duration?: number;
    steps?: Array<{ type?: string; id?: string | number }>;
  }>;
}

export class VroomClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async solve(
    vehicles: VroomVehicleInput[],
    shipments: VroomShipmentInput[],
    matrices: OsrmMatrix,
    locationCount: number,
  ): Promise<VroomSolution> {
    if (matrices.durations.length !== locationCount) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "matrix/location count mismatch");
    }
    const body = {
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        start_index: vehicle.startIndex,
        end_index: vehicle.endIndex,
        ...(vehicle.capacity ? { capacity: vehicle.capacity } : {}),
        ...(vehicle.timeWindow ? { time_window: vehicle.timeWindow } : {}),
      })),
      shipments: shipments.map((shipment) => ({
        pickup: {
          id: `${shipment.id}::pickup`,
          location_index: shipment.pickupIndex,
          ...(shipment.pickupServiceSeconds !== undefined
            ? { service: shipment.pickupServiceSeconds }
            : {}),
          ...(shipment.pickupWindow ? { time_windows: [shipment.pickupWindow] } : {}),
        },
        delivery: {
          id: `${shipment.id}::delivery`,
          location_index: shipment.deliveryIndex,
          ...(shipment.deliveryServiceSeconds !== undefined
            ? { service: shipment.deliveryServiceSeconds }
            : {}),
          ...(shipment.deliveryWindow ? { time_windows: [shipment.deliveryWindow] } : {}),
        },
        amount: shipment.amount ?? [1],
      })),
      matrices: { car: { durations: matrices.durations, distances: matrices.distances } },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let payload: VroomResponse;
    try {
      const response = await this.fetchFn(this.baseUrl.replace(/\/$/, ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new RoutingError("VROOM_UNAVAILABLE", `VROOM responded ${response.status}`);
      }
      payload = (await response.json()) as VroomResponse;
    } catch (err) {
      if (err instanceof RoutingError) {
        throw err;
      }
      throw new RoutingError("VROOM_UNAVAILABLE", "VROOM could not be reached");
    } finally {
      clearTimeout(timer);
    }

    if (payload.code !== 0) {
      throw new RoutingError(
        "ROUTING_INVALID_RESPONSE",
        `VROOM rejected the request: ${payload.error ?? payload.code ?? "unknown"}`,
      );
    }

    const orderByVehicle = new Map<number, string[]>();
    const routes: VroomSolution["routes"] = [];
    for (const route of payload.routes ?? []) {
      if (typeof route.vehicle !== "number") {
        continue;
      }
      const ordered: string[] = [];
      for (const step of route.steps ?? []) {
        if (step.type !== "pickup" && step.type !== "delivery") {
          continue;
        }
        const raw = String(step.id ?? "");
        const shipmentId = raw.split("::")[0];
        if (shipmentId && !ordered.includes(shipmentId)) {
          ordered.push(shipmentId);
        }
      }
      orderByVehicle.set(route.vehicle, ordered);
      routes.push({
        vehicleId: route.vehicle,
        distanceMetres: Number(route.distance ?? 0),
        durationSeconds: Number(route.duration ?? 0),
      });
    }

    const unassigned = (payload.unassigned ?? [])
      .map((entry) => String(entry.id ?? "").split("::")[0])
      .filter((id): id is string => Boolean(id));

    return { orderByVehicle, unassigned, routes };
  }
}
