/**
 * In-memory demo store (ADR-0007): the same domain model the production
 * repository will serve, with deterministic seeds, scenario reset,
 * idempotent commands and a transactional-style outbox. DEMO_MODE only.
 */
import { randomUUID } from "node:crypto";
import type {
  AlertDto,
  AssignResponse,
  AssignmentPreview,
  DriverDto,
  EventEnvelope,
  FleetState,
  JobDto,
  JobPriority,
  ScenarioName,
  VehicleDto,
  VehiclePosition,
} from "@privatefleet/contracts";
import { EVENT_SCHEMA_VERSION } from "@privatefleet/contracts";
import {
  buildJobDto,
  DEMO_TENANT_ID,
  DRIVER_SEEDS,
  JOB_SEEDS,
  SIMULATOR_ROUTES,
} from "./data.js";

const STALE_AFTER_MS = 60_000;

interface JobRecord {
  dto: JobDto;
}

interface VehicleRecord {
  dto: VehicleDto;
  route: { latitude: number; longitude: number }[];
  routeIndex: number;
  sequenceNo: number;
  lastCapturedAt: string;
}

export class DemoStore {
  private scenario: ScenarioName = "morning-rush";
  private drivers = new Map<string, DriverDto>();
  private vehicles = new Map<string, VehicleRecord>();
  private jobs = new Map<string, JobRecord>();
  private alerts: AlertDto[] = [];
  private outbox: EventEnvelope[] = [];
  private receipts = new Map<string, AssignResponse>();
  private telemetrySequence = 0;

  constructor(scenario: ScenarioName) {
    this.reset(scenario);
  }

  reset(scenario: ScenarioName): void {
    this.scenario = scenario;
    this.drivers.clear();
    this.vehicles.clear();
    this.jobs.clear();
    this.alerts = [];
    this.outbox = [];
    this.receipts.clear();

    const now = new Date().toISOString();

    for (const seed of DRIVER_SEEDS) {
      const driverStatus =
        scenario === "proof" && seed.id === DRIVER_SEEDS[0]?.id
          ? "on_route"
          : scenario === "emergency" && seed.id === DRIVER_SEEDS[1]?.id
            ? "on_route"
            : "available";
      this.drivers.set(seed.id, {
        id: seed.id,
        fullName: seed.fullName,
        status: driverStatus,
        vehicleId: seed.vehicleId,
        lastPingAt: now,
      });
      this.vehicles.set(seed.vehicleId, {
        dto: {
          id: seed.vehicleId,
          registration: seed.vehicleRegistration,
          vehicleType: seed.vehicleType,
          status: driverStatus === "on_route" ? "on_route" : "available",
          driverId: seed.id,
          stale: false,
        },
        route: SIMULATOR_ROUTES[seed.vehicleId] ?? [seed.start],
        routeIndex: 0,
        sequenceNo: 0,
        lastCapturedAt: now,
      });
    }

    for (const seed of JOB_SEEDS) {
      const dto = buildJobDto(seed);
      if (scenario === "emergency" && seed.reference === "J-208") {
        dto.priority = "stat" satisfies JobPriority;
      }
      if (scenario === "proof" && seed.reference === "J-198") {
        const driver = DRIVER_SEEDS[0];
        if (driver) {
          dto.status = "in_progress";
          dto.assignedDriverId = driver.id;
          dto.assignedVehicleId = driver.vehicleId;
          const first = dto.stops[0];
          if (first) {
            first.status = "arrived";
          }
        }
      }
      this.jobs.set(seed.id, { dto });
    }

    if (scenario === "morning-rush") {
      this.alerts.push(this.alert("at_risk", "J-198 likely to arrive 8 minutes late", "J-198"));
    }
    if (scenario === "emergency") {
      this.alerts.push(this.alert("urgent", "J-208 STAT request received - needs a driver now", "J-208"));
    }
  }

  get currentScenario(): ScenarioName {
    return this.scenario;
  }

  vehicleIds(): string[] {
    return [...this.vehicles.keys()];
  }

  private alert(
    severity: AlertDto["severity"],
    title: string,
    reference: string,
  ): AlertDto {
    const job = [...this.jobs.values()].find((j) => j.dto.reference === reference);
    return {
      id: randomUUID(),
      severity,
      title,
      relatedJobId: job?.dto.id,
      createdAt: new Date().toISOString(),
    };
  }

  /** Deterministic demo projection - labelled simulated, never fake solver math. */
  preview(jobId: string, driverId: string): AssignmentPreview {
    const job = this.jobs.get(jobId)?.dto;
    const driver = this.drivers.get(driverId);
    if (!job || !driver) {
      throw new Error("JOB_OR_DRIVER_NOT_FOUND");
    }
    const constraints: string[] = [];
    if (driver.status === "suspended" || driver.status === "off_duty") {
      constraints.push("Driver not on shift");
    }
    if (job.assignedDriverId && job.assignedDriverId !== driverId) {
      constraints.push("Job already assigned to another driver");
    }
    const hash = (jobId + driverId).split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const etaImpactMinutes = 3 + (hash % 9);
    return {
      jobId,
      driverId,
      demoMode: true,
      etaImpactMinutes,
      message: `Assigning this to ${driver.fullName} adds ${etaImpactMinutes} min to their next stop. Confirm?`,
      constraintsViolated: constraints,
    };
  }

  assign(jobId: string, driverId: string, idempotencyKey: string): AssignResponse {
    const receiptKey = `${DEMO_TENANT_ID}:${idempotencyKey}`;
    const existing = this.receipts.get(receiptKey);
    if (existing) {
      return existing;
    }
    const job = this.jobs.get(jobId);
    const driver = this.drivers.get(driverId);
    if (!job || !driver) {
      throw new Error("JOB_OR_DRIVER_NOT_FOUND");
    }
    if (job.dto.status !== "unassigned") {
      if (job.dto.assignedDriverId === driverId) {
        // Idempotent replay of an already-accepted assignment.
        const impact = this.preview(jobId, driverId);
        return {
          jobId,
          driverId,
          vehicleId: job.dto.assignedVehicleId ?? driver.vehicleId ?? "",
          status: "assigned",
          etaImpactMinutes: impact.etaImpactMinutes,
        };
      }
      throw new Error("JOB_ASSIGNMENT_CONFLICT");
    }
    const vehicleId = driver.vehicleId;
    if (!vehicleId) {
      throw new Error("DRIVER_HAS_NO_VEHICLE");
    }
    const impact = this.preview(jobId, driverId);
    job.dto.status = "assigned";
    job.dto.assignedDriverId = driverId;
    job.dto.assignedVehicleId = vehicleId;
    job.dto.version += 1;
    const result: AssignResponse = {
      jobId,
      driverId,
      vehicleId,
      status: "assigned",
      etaImpactMinutes: impact.etaImpactMinutes,
    };
    this.receipts.set(receiptKey, result);
    this.outbox.push({
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: DEMO_TENANT_ID,
      aggregateType: "job",
      aggregateId: jobId,
      type: "job.assigned",
      occurredAt: new Date().toISOString(),
      payload: {
        jobId,
        driverId,
        vehicleId,
        routeId: `route-${vehicleId}`,
        etaImpactMinutes: impact.etaImpactMinutes,
      },
    });
    return result;
  }

  drainOutbox(): EventEnvelope[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  advanceVehicle(vehicleId: string): VehiclePosition | undefined {
    const record = this.vehicles.get(vehicleId);
    if (!record) {
      return undefined;
    }
    const route = record.route;
    record.routeIndex = (record.routeIndex + 0.02) % (route.length - 1);
    const from = route[Math.floor(record.routeIndex)];
    const to = route[Math.floor(record.routeIndex) + 1];
    if (!from || !to) {
      return undefined;
    }
    const t = record.routeIndex % 1;
    const latitude = from.latitude + (to.latitude - from.latitude) * t;
    const longitude = from.longitude + (to.longitude - from.longitude) * t;
    const headingDeg =
      (Math.atan2(to.longitude - from.longitude, to.latitude - from.latitude) * 180) / Math.PI;
    record.sequenceNo += 1;
    record.lastCapturedAt = new Date().toISOString();
    return {
      vehicleId,
      driverId: record.dto.driverId ?? "",
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
      headingDeg: Number(headingDeg.toFixed(1)),
      capturedAt: record.lastCapturedAt,
      sequenceNo: record.sequenceNo + this.telemetrySequence++,
    };
  }

  fleetState(): FleetState {
    const now = Date.now();
    const vehicles: VehicleDto[] = [...this.vehicles.values()].map((record) => {
      const point = record.route[0];
      const stale = now - Date.parse(record.lastCapturedAt) > STALE_AFTER_MS;
      return {
        ...record.dto,
        location: point ? { latitude: point.latitude, longitude: point.longitude } : undefined,
        stale,
      };
    });
    return {
      tenantId: DEMO_TENANT_ID,
      scenario: this.scenario,
      demoMode: true,
      drivers: [...this.drivers.values()],
      vehicles,
      jobs: [...this.jobs.values()].map((j) => j.dto),
      alerts: this.alerts,
      serverTime: new Date().toISOString(),
    };
  }
}
