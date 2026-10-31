/**
 * VROOM HTTP adapter (docs/10.3): shipments (paired pickup/delivery) and
 * single-stop jobs, matrices supplied by OSRM, validated solution output
 * with solver-provided arrival times.
 */
import {
  RoutingError,
  type OsrmMatrix,
  type VroomJobInput,
  type VroomShipmentInput,
  type VroomSolution,
  type VroomUnitRef,
  type VroomVisitRef,
  type VroomVehicleInput,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

interface VroomResponse {
  code?: number;
  error?: string;
  unassigned?: Array<{ id?: string | number; description?: string }>;
  routes?: Array<{
    vehicle?: number;
    distance?: number;
    duration?: number;
    steps?: Array<{ type?: string; id?: string | number; arrival?: number }>;
  }>;
}

interface NumericUnit {
  kind: "shipment" | "job";
  id: string;
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
    jobs: VroomJobInput[] = [],
  ): Promise<VroomSolution> {
    if (matrices.durations.length !== locationCount) {
      throw new RoutingError("ROUTING_INVALID_RESPONSE", "matrix/location count mismatch");
    }
    // VROOM 1.13 skill values are integers, while the domain models
    // capability names. Map names deterministically to per-request ids.
    const skillIds = new Map<string, number>();
    const skillId = (name: string): number => {
      const existing = skillIds.get(name);
      if (existing !== undefined) {
        return existing;
      }
      const next = skillIds.size + 1;
      skillIds.set(name, next);
      return next;
    };

    const numericUnit = new Map<number, NumericUnit>();
    const bodyShipments = shipments.map((shipment, index) => {
      const pickupId = index * 2 + 1;
      const deliveryId = index * 2 + 2;
      numericUnit.set(pickupId, { kind: "shipment", id: shipment.id });
      numericUnit.set(deliveryId, { kind: "shipment", id: shipment.id });
      return {
        pickup: {
          id: pickupId,
          location_index: shipment.pickupIndex,
          ...(shipment.pickupServiceSeconds !== undefined
            ? { service: shipment.pickupServiceSeconds }
            : {}),
          ...(shipment.pickupWindow ? { time_windows: [shipment.pickupWindow] } : {}),
        },
        delivery: {
          id: deliveryId,
          location_index: shipment.deliveryIndex,
          ...(shipment.deliveryServiceSeconds !== undefined
            ? { service: shipment.deliveryServiceSeconds }
            : {}),
          ...(shipment.deliveryWindow ? { time_windows: [shipment.deliveryWindow] } : {}),
        },
        ...(shipment.amount ? { amount: shipment.amount } : {}),
      };
    });
    const jobIdBase = shipments.length * 2;
    const bodyJobs = jobs.map((job, index) => {
      const numericId = jobIdBase + index + 1;
      numericUnit.set(numericId, { kind: "job", id: job.id });
      return {
        id: numericId,
        location_index: job.locationIndex,
        ...(job.serviceSeconds !== undefined ? { service: job.serviceSeconds } : {}),
        ...(job.timeWindow ? { time_windows: [job.timeWindow] } : {}),
        ...(job.skills?.length ? { skills: job.skills.map((name) => skillId(name)) } : {}),
        ...(job.amount ? { amount: job.amount } : {}),
      };
    });

    const body = {
      vehicles: vehicles.map((vehicle) => ({
        id: vehicle.id,
        start_index: vehicle.startIndex,
        end_index: vehicle.endIndex,
        ...(vehicle.capacity ? { capacity: vehicle.capacity } : {}),
        ...(vehicle.timeWindow ? { time_window: vehicle.timeWindow } : {}),
    ...(vehicle.maxDistance ? { max_distance: vehicle.maxDistance } : {}),
    ...(vehicle.maxTravelTime ? { max_travel_time: vehicle.maxTravelTime } : {}),
    ...(vehicle.maxTasks ? { max_tasks: vehicle.maxTasks } : {}),
        ...(vehicle.skills?.length
          ? { skills: vehicle.skills.map((name) => skillId(name)) }
          : {}),
      })),
      shipments: bodyShipments,
      jobs: bodyJobs,
      matrices: {
        car: {
          durations: matrices.durations.map((row) => row.map((value) => Math.round(value))),
          distances: matrices.distances.map((row) => row.map((value) => Math.round(value))),
        },
      },
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
        const detail = await response.text().catch(() => "");
        throw new RoutingError(
          "VROOM_UNAVAILABLE",
          `VROOM responded ${response.status}${detail ? ": " + detail.slice(0, 300) : ""}`,
        );
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
    const ordersByVehicle = new Map<number, VroomUnitRef[]>();
    const visitsByVehicle = new Map<number, VroomVisitRef[]>();
    const arrivalsByVehicle = new Map<number, Map<string, number>>();
    const routes: VroomSolution["routes"] = [];
    for (const route of payload.routes ?? []) {
      if (typeof route.vehicle !== "number") {
        continue;
      }
      const units: VroomUnitRef[] = [];
      const visits: VroomVisitRef[] = [];
      const arrivalMap = new Map<string, number>();
      for (const step of route.steps ?? []) {
        if (step.type !== "pickup" && step.type !== "delivery" && step.type !== "job") {
          continue;
        }
        const unit = numericUnit.get(Number(step.id));
        if (!unit) {
          continue;
        }
        const key = `${unit.kind}:${unit.id}:${step.type}`;
        if (typeof step.arrival === "number" && Number.isFinite(step.arrival)) {
          arrivalMap.set(key, step.arrival);
        }
        visits.push({
          kind: unit.kind,
          id: unit.id,
          role: step.type === "job" ? "job" : step.type,
        });
        if (!units.some((entry) => entry.kind === unit.kind && entry.id === unit.id)) {
          units.push({ ...unit });
        }
      }
      ordersByVehicle.set(route.vehicle, units);
      visitsByVehicle.set(route.vehicle, visits);
      arrivalsByVehicle.set(route.vehicle, arrivalMap);
      orderByVehicle.set(
        route.vehicle,
        units.filter((unit) => unit.kind === "shipment").map((unit) => unit.id),
      );
      routes.push({
        vehicleId: route.vehicle,
        distanceMetres: Number(route.distance ?? 0),
        durationSeconds: Number(route.duration ?? 0),
      });
    }

    const unassigned: string[] = [];
    const unassignedReasons = new Map<string, string>();
    for (const entry of payload.unassigned ?? []) {
      const unit = numericUnit.get(Number(entry.id));
      if (!unit) {
        continue;
      }
      if (!unassigned.includes(unit.id)) {
        unassigned.push(unit.id);
      }
      if (entry.description) {
        unassignedReasons.set(unit.id, entry.description);
      }
    }

    return {
      orderByVehicle,
      ordersByVehicle,
      visitsByVehicle,
      arrivalsByVehicle,
      unassigned,
      unassignedReasons,
      routes,
    };
  }
}








