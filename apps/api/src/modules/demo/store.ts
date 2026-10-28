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
  OptimizationProposal,
  OptimizedStop,
  ScenarioName,
  ServiceZone,
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
import { ROUTE_GEOMETRY } from "./route-geometry.js";
import { SCENARIO_ASSIGNMENTS } from "./assignments.js";

const STALE_AFTER_MS = 60_000;

/** Demo speed: 40 km/h. Movement is speed x time, not point counting. */
export const DEMO_SPEED_MPS = 40_000 / 3_600;
export const SIMULATOR_TICK_SECONDS = 2;

function haversineMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  // Degrees scaled by metres-per-degree (do not mix radians here).
  const dLat = b.latitude - a.latitude;
  const dLon = b.longitude - a.longitude;
  const latRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const x = dLon * 111_320 * Math.cos(latRad);
  const y = dLat * 110_540;
  return Math.sqrt(x * x + y * y);
}

function cumulativeDistances(route: { latitude: number; longitude: number }[]): {
  cumulative: number[];
  total: number;
} {
  const cumulative: number[] = [0];
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    if (previous && current) {
      total += haversineMetres(previous, current);
    }
    cumulative.push(total);
  }
  return { cumulative, total };
}

interface JobRecord {
  dto: JobDto;
}

interface VehicleRecord {
  dto: VehicleDto;
  route: { latitude: number; longitude: number }[];
  /** Cumulative distance in metres at each route point (last = total). */
  cumulative: number[];
  totalDistance: number;
  /** Distance travelled along the route in metres. */
  distanceAlong: number;
  segmentIndex: number;
  sequenceNo: number;
  lastCapturedAt: string;
}

export class DemoStore {
  private scenario: ScenarioName = "morning-rush";
  private drivers = new Map<string, DriverDto>();
  private vehicles = new Map<string, VehicleRecord>();
  private jobs = new Map<string, JobRecord>();
  private alerts: AlertDto[] = [];
  private serviceZones: ServiceZone[] = [];
  private outbox: EventEnvelope[] = [];
  private receipts = new Map<string, AssignResponse>();
  private telemetrySequence = 0;
  private lastRun: OptimizationProposal | undefined;
  private benchmarkVehicles = 0;

  constructor(scenario: ScenarioName) {
    this.reset(scenario);
  }

  reset(scenario: ScenarioName): void {
    this.scenario = scenario;
    this.drivers.clear();
    this.vehicles.clear();
    this.jobs.clear();
    this.alerts = [];
    this.serviceZones = [];
    this.outbox = [];
    this.receipts.clear();
    this.lastRun = undefined;

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
      const fixture = ROUTE_GEOMETRY[scenario]?.[seed.vehicleId];
      const route = fixture?.points ?? SIMULATOR_ROUTES[seed.vehicleId] ?? [seed.start];
      const { cumulative, total } = cumulativeDistances(route);
      this.vehicles.set(seed.vehicleId, {
        dto: {
          id: seed.vehicleId,
          registration: seed.vehicleRegistration,
          vehicleType: seed.vehicleType,
          status: driverStatus === "on_route" ? "on_route" : "available",
          driverId: seed.id,
          stale: false,
        },
        // Precomputed road-following demo geometry (OSRM fixtures); the
        // simulator and the rendered route share this exact path.
        route,
        cumulative,
        totalDistance: total,
        distanceAlong: 0,
        segmentIndex: 0,
        sequenceNo: 0,
        lastCapturedAt: now,
      });
    }

    for (const [index, seed] of JOB_SEEDS.entries()) {
      const dto = buildJobDto(seed, index);
      if (scenario === "emergency" && seed.reference === "J-208") {
        dto.priority = "stat" satisfies JobPriority;
      }
      // Assignment truth shared with the route-fixture generator: the
      // board, the rendered route and the simulator cannot drift apart.
      const plan = SCENARIO_ASSIGNMENTS[scenario].find((p) => p.ref === seed.reference);
      if (plan) {
        const driver = DRIVER_SEEDS[plan.driver];
        if (driver) {
          dto.status = plan.started ? "in_progress" : "assigned";
          dto.assignedDriverId = driver.id;
          dto.assignedVehicleId = driver.vehicleId;
          if (plan.started) {
            const first = dto.stops[0];
            if (first) {
              first.status = "arrived";
            }
          }
        }
      }
      this.jobs.set(seed.id, { dto });
    }

    if (scenario === "morning-rush") {
      this.alerts.push(
        this.seedAlert({
          severity: "urgent",
          title: "J-208 STAT pickup unassigned - assign a driver now",
          entity: "STAT intake",
          location: "Farringdon",
          freshness: "received 2 minutes ago",
          recommendedAction: "Drag J-208 onto the nearest driver",
          reference: "J-208",
        }),
        this.seedAlert({
          severity: "at_risk",
          title: "Sarah has been stationary for 15 minutes",
          entity: "Sarah Reed - VAN-02",
          location: "Camden clinic",
          freshness: "updated 44 sec ago",
          recommendedAction: "Call driver to check for a loading delay",
        }),
        this.seedAlert({
          severity: "info",
          title: "Vehicle CAR-03 has stopped reporting",
          entity: "Tom Cole - CAR-03",
          location: "last known near Farringdon",
          freshness: "last update 2 min 10 sec ago",
          recommendedAction: "Mark stale and notify the driver",
        }),
      );
    }
    if (scenario === "emergency") {
      this.alerts.push(
        this.seedAlert({
          severity: "urgent",
          title: "J-208 STAT request received - needs a driver now",
          entity: "STAT intake",
          location: "Farringdon",
          freshness: "received just now",
          recommendedAction: "Drag J-208 onto the nearest available driver",
          reference: "J-208",
        }),
        this.seedAlert({
          severity: "at_risk",
          title: "Vehicle CAR-03 has stopped reporting",
          entity: "Tom Cole - CAR-03",
          location: "last known near Farringdon",
          freshness: "last update 2 min 10 sec ago",
          recommendedAction: "Mark stale and notify the driver",
        }),
      );
    }
    if (scenario === "proof") {
      this.alerts.push(
        this.seedAlert({
          severity: "at_risk",
          title: "J-198 ETA drift +8 min",
          entity: "Sarah Reed - VAN-02",
          location: "St Thomas' Hospital",
          freshness: "updated 24 sec ago",
          recommendedAction: "Notify the customer of the revised ETA",
          reference: "J-198",
        }),
      );
    }

    this.serviceZones =
      scenario === "emergency"
        ? [
            { id: randomUUID(), name: "St Thomas' Hospital", status: "ok", vehiclesInside: 2, note: "2 vehicles inside" },
            { id: randomUUID(), name: "Camden Clinic", status: "ok", vehiclesInside: 1, note: "1 vehicle inside" },
            { id: randomUUID(), name: "London Bridge Dock", status: "unexpected_exit", vehiclesInside: 0, note: "Tom Cole exited the service zone" },
            { id: randomUUID(), name: "Farringdon Depot", status: "no_arrivals", vehiclesInside: 0, note: "No recent arrivals" },
          ]
        : [
            { id: randomUUID(), name: "St Thomas' Hospital", status: "ok", vehiclesInside: 2, note: "2 vehicles inside" },
            { id: randomUUID(), name: "Camden Clinic", status: "ok", vehiclesInside: 1, note: "1 vehicle inside" },
            { id: randomUUID(), name: "London Bridge Dock", status: "ok", vehiclesInside: 3, note: "3 vehicles inside" },
            { id: randomUUID(), name: "Farringdon Depot", status: "no_arrivals", vehiclesInside: 0, note: "No recent arrivals" },
          ];
  }

  get currentScenario(): ScenarioName {
    return this.scenario;
  }

  vehicleIds(): string[] {
    return [...this.vehicles.keys()];
  }

  private seedAlert(input: {
    severity: AlertDto["severity"];
    title: string;
    entity: string;
    location: string;
    freshness: string;
    recommendedAction: string;
    reference?: string;
  }): AlertDto {
    const job = input.reference
      ? [...this.jobs.values()].find((j) => j.dto.reference === input.reference)
      : undefined;
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      severity: input.severity,
      title: input.title,
      relatedJobId: job?.dto.id,
      createdAt: now,
      entity: input.entity,
      location: input.location,
      freshness: input.freshness,
      recommendedAction: input.recommendedAction,
      acknowledged: false,
      audit: [{ at: now, message: "Alert automatically created" }],
    };
  }

  actOnAlert(alertId: string, action: "acknowledge" | "resolve"): AlertDto {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert) {
      throw new Error("ALERT_NOT_FOUND");
    }
    const now = new Date().toISOString();
    if (action === "acknowledge") {
      alert.acknowledged = true;
      alert.audit.push({ at: now, message: "Alert acknowledged by dispatcher" });
      this.pushAlertEvent(alert, "alert.acknowledged");
      return alert;
    }
    this.alerts = this.alerts.filter((a) => a.id !== alertId);
    this.pushAlertEvent(alert, "alert.resolved");
    return alert;
  }

  private pushAlertEvent(alert: AlertDto, type: string): void {
    this.outbox.push({
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: DEMO_TENANT_ID,
      aggregateType: "alert",
      aggregateId: alert.id,
      type,
      occurredAt: new Date().toISOString(),
      payload: { alertId: alert.id, title: alert.title, severity: alert.severity },
    });
  }

  /**
   * Driver commands (docs/08.2): server-authoritative stop transitions.
   * The driver app queues these with idempotency keys; the server is the
   * only party that decides accepted state.
   */
  startShift(driverId: string): DriverDto {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      throw new Error("JOB_OR_DRIVER_NOT_FOUND");
    }
    if (driver.status === "off_duty") {
      driver.status = "available";
    }
    return driver;
  }

  driverQueue(driverId: string): { driver: DriverDto; jobs: JobDto[] } {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      throw new Error("JOB_OR_DRIVER_NOT_FOUND");
    }
    const jobs = [...this.jobs.values()]
      .map((j) => j.dto)
      .filter(
        (j) =>
          j.assignedDriverId === driverId &&
          (j.status === "assigned" || j.status === "in_progress"),
      );
    return { driver, jobs };
  }

  private requireStop(jobId: string, stopId: string, driverId: string) {
    const record = this.jobs.get(jobId);
    const stop = record?.dto.stops.find((s) => s.id === stopId);
    if (!record || !stop) {
      throw new Error("STOP_NOT_FOUND");
    }
    if (record.dto.assignedDriverId !== driverId) {
      throw new Error("STOP_NOT_ASSIGNED_TO_DRIVER");
    }
    return { record, stop };
  }

  arrive(jobId: string, stopId: string, driverId: string): JobDto {
    const { record, stop } = this.requireStop(jobId, stopId, driverId);
    if (stop.status === "arrived") {
      return record.dto;
    }
    if (stop.status !== "pending") {
      throw new Error("INVALID_STOP_TRANSITION");
    }
    const now = new Date().toISOString();
    stop.status = "arrived";
    stop.arrivedAt = now;
    record.dto.status = "in_progress";
    this.outbox.push({
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: DEMO_TENANT_ID,
      aggregateType: "stop",
      aggregateId: stopId,
      type: "stop.arrived",
      occurredAt: now,
      payload: { jobId, stopId, driverId, capturedAt: now, receivedAt: now },
    });
    return record.dto;
  }

  complete(
    jobId: string,
    stopId: string,
    driverId: string,
    payload: { recipientName?: string | undefined; notes?: string | undefined },
  ): JobDto {
    const { record, stop } = this.requireStop(jobId, stopId, driverId);
    if (stop.status === "completed") {
      return record.dto;
    }
    if (stop.status !== "pending" && stop.status !== "arrived") {
      throw new Error("INVALID_STOP_TRANSITION");
    }
    const now = new Date().toISOString();
    stop.status = "completed";
    stop.completedAt = now;
    this.outbox.push({
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: DEMO_TENANT_ID,
      aggregateType: "stop",
      aggregateId: stopId,
      type: "stop.completed",
      occurredAt: now,
      payload: { jobId, stopId, driverId, recipientName: payload.recipientName },
    });
    if (payload.recipientName) {
      this.outbox.push({
        eventId: randomUUID(),
        schemaVersion: EVENT_SCHEMA_VERSION,
        tenantId: DEMO_TENANT_ID,
        aggregateType: "pod",
        aggregateId: stopId,
        type: "pod.captured",
        occurredAt: now,
        payload: { jobId, stopId, kind: "note", recipientName: payload.recipientName },
      });
    }
    if (record.dto.stops.every((s) => s.status === "completed" || s.status === "skipped")) {
      record.dto.status = "completed";
      this.outbox.push({
        eventId: randomUUID(),
        schemaVersion: EVENT_SCHEMA_VERSION,
        tenantId: DEMO_TENANT_ID,
        aggregateType: "job",
        aggregateId: jobId,
        type: "job.completed",
        occurredAt: now,
        payload: { jobId, driverId },
      });
    }
    return record.dto;
  }

  skip(jobId: string, stopId: string, driverId: string, reason: string): JobDto {
    const { record, stop } = this.requireStop(jobId, stopId, driverId);
    if (stop.status !== "pending" && stop.status !== "arrived") {
      throw new Error("INVALID_STOP_TRANSITION");
    }
    const now = new Date().toISOString();
    stop.status = "skipped";
    this.outbox.push({
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: DEMO_TENANT_ID,
      aggregateType: "stop",
      aggregateId: stopId,
      type: "stop.skipped",
      occurredAt: now,
      payload: { jobId, stopId, driverId, reason },
    });
    this.alerts.push(
      this.seedAlert({
        severity: "at_risk",
        title: `Stop skipped at ${stop.address} - ${reason}`,
        entity: "Driver report",
        location: stop.address,
        freshness: "just now",
        recommendedAction: "Review the skip reason and reassign if needed",
        reference: record.dto.reference,
      }),
    );
    return record.dto;
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
    // Deterministic demo cascade: every pending stop downstream of this
    // driver shifts by the impact (labelled simulated, docs/05.5 step 2).
    const driverStops = [...this.jobs.values()]
      .filter((j) => j.dto.assignedDriverId === driverId && j.dto.id !== jobId)
      .flatMap((j) => j.dto.stops)
      .filter((s) => s.status === "pending");
    const newStops = job.stops.filter((s) => s.status === "pending");
    const etaCascade = [...driverStops, ...newStops].map((s) => ({
      address: s.address,
      arrivalDeltaMinutes: etaImpactMinutes,
    }));
    return {
      jobId,
      driverId,
      demoMode: true,
      etaImpactMinutes,
      message: `Assigning this to ${driver.fullName} adds ${etaImpactMinutes} min to their next stop. Confirm?`,
      constraintsViolated: constraints,
      etaCascade,
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

  /**
   * Seeded optimisation proposal (docs/10.4): deterministic nearest-
   * neighbour reorder with the documented demo metrics, labelled
   * simulated. Real VROOM/OSRM output arrives in Phase 5.
   */
  runOptimization(driverId: string): OptimizationProposal {
    const driver = this.drivers.get(driverId);
    if (!driver) {
      throw new Error("JOB_OR_DRIVER_NOT_FOUND");
    }
    const candidates = [...this.jobs.values()]
      .map((j) => j.dto)
      .sort((a, b) => a.reference.localeCompare(b.reference))
      .slice(0, 3)
      .flatMap((j) =>
        j.stops.map((s) => ({
          jobId: s.jobId,
          jobRef: j.reference,
          address: s.address,
          stopType: s.stopType,
          location: s.location,
        })),
      );

    const base = new Date();
    base.setHours(8, 0, 0, 0);
    const baseline: OptimizedStop[] = candidates.map((s, i) => ({
      jobId: s.jobId,
      jobRef: s.jobRef,
      address: s.address,
      stopType: s.stopType,
      arrivalAt: new Date(base.getTime() + i * 22 * 60_000).toISOString(),
      feasible: i < candidates.length - 2,
    }));

    const rest = [...candidates];
    const ordered: typeof candidates = [];
    let current = rest.shift();
    while (current && rest.length > 0) {
      ordered.push(current);
      const cur = current;
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      rest.forEach((s, i) => {
        const distance =
          (s.location.latitude - cur.location.latitude) ** 2 +
          (s.location.longitude - cur.location.longitude) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      });
      if (bestIndex >= 0) {
        current = rest.splice(bestIndex, 1)[0] ?? undefined;
      } else {
        break;
      }
    }
    if (current) {
      ordered.push(current);
    }

    const proposal: OptimizedStop[] = ordered.map((s, i) => ({
      jobId: s.jobId,
      jobRef: s.jobRef,
      address: s.address,
      stopType: s.stopType,
      arrivalAt: new Date(base.getTime() + 15 * 60_000 + i * 19 * 60_000).toISOString(),
      feasible: true,
    }));

    const run: OptimizationProposal = {
      runId: randomUUID(),
      driverId,
      driverName: driver.fullName,
      demoMode: true,
      engine: "seeded-demo",
      engineVersion: "seed-v1",
      status: "succeeded",
      published: false,
      baseline: {
        distanceMiles: 31.6,
        durationMinutes: 138,
        atRiskWindows: 2,
        stops: baseline,
      },
      proposal: {
        distanceMiles: 23.2,
        durationMinutes: 115,
        feasibleWindows: true,
        stops: proposal,
      },
      savedMinutes: 23,
      savedMiles: 8.4,
    };
    this.lastRun = run;
    return run;
  }

  approve(runId: string): OptimizationProposal {
    if (!this.lastRun || this.lastRun.runId !== runId) {
      throw new Error("OPTIMIZATION_RUN_NOT_FOUND");
    }
    const run: OptimizationProposal = {
      ...this.lastRun,
      published: true,
      publishedAt: new Date().toISOString(),
    };
    this.lastRun = run;
    this.outbox.push({
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: DEMO_TENANT_ID,
      aggregateType: "route",
      aggregateId: runId,
      type: "route.published",
      occurredAt: new Date().toISOString(),
      payload: {
        runId,
        driverId: run.driverId,
        savedMinutes: run.savedMinutes,
        savedMiles: run.savedMiles,
      },
    });
    return run;
  }

  advanceVehicle(vehicleId: string): VehiclePosition | undefined {
    const record = this.vehicles.get(vehicleId);
    if (!record) {
      return undefined;
    }
    const route = record.route;
    const distanceStep = DEMO_SPEED_MPS * SIMULATOR_TICK_SECONDS;
    if (record.totalDistance <= 0 || route.length < 2) {
      return undefined;
    }
    // Movement is distance over time: advance along the cumulative
    // distance, then interpolate inside the containing segment.
    record.distanceAlong = (record.distanceAlong + distanceStep) % record.totalDistance;
    let segment = record.segmentIndex;
    if (record.distanceAlong < (record.cumulative[segment] ?? 0)) {
      segment = 0; // wrapped around the end of the circuit
    }
    while (
      segment < route.length - 2 &&
      (record.cumulative[segment + 1] ?? 0) < record.distanceAlong
    ) {
      segment += 1;
    }
    record.segmentIndex = segment;
    const from = route[segment];
    const to = route[segment + 1];
    if (!from || !to) {
      return undefined;
    }
    const legStart = record.cumulative[segment] ?? 0;
    const legEnd = record.cumulative[segment + 1] ?? legStart + 1;
    const legDistance = legEnd - legStart;
    const t = legDistance > 0 ? (record.distanceAlong - legStart) / legDistance : 0;
    const latitude = from.latitude + (to.latitude - from.latitude) * t;
    const longitude = from.longitude + (to.longitude - from.longitude) * t;
    const headingDeg =
      (Math.atan2(to.longitude - from.longitude, to.latitude - from.latitude) * 180) / Math.PI;
    record.sequenceNo += 1;
    record.lastCapturedAt = new Date().toISOString();
    // Keep the canonical DTO position in step with the simulated fix so
    // fleet state (and therefore the map) follows the route instead of
    // being frozen at the route's first point.
    record.dto.location = {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    };
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

  /**
   * Demo-only benchmark load: adds N synthetic vehicles on closed loops so
   * the 250-vehicle performance gate exercises the real telemetry path.
   * Never available in postgres mode (demo routes are not registered).
   */
  loadBenchmarkVehicles(count: number): number {
    const center = { latitude: 51.5074, longitude: -0.1278 };
    const now = new Date().toISOString();
    while (this.benchmarkVehicles < count) {
      const index = this.benchmarkVehicles;
      const id = `bench-${String(index).padStart(3, "0")}`;
      const driverId = `bench-driver-${String(index).padStart(3, "0")}`;
      const radiusLat = 0.02 + (index % 5) * 0.002;
      const radiusLon = 0.03 + (index % 7) * 0.002;
      const points = Array.from({ length: 120 }, (_, step) => {
        const angle = (step / 120) * Math.PI * 2;
        return {
          latitude: center.latitude + Math.sin(angle) * radiusLat,
          longitude: center.longitude + Math.cos(angle) * radiusLon,
        };
      });
      const start = points[0];
      if (!start) {
        break;
      }
      points.push({ ...start });
      const { cumulative, total } = cumulativeDistances(points);
      this.vehicles.set(id, {
        dto: {
          id,
          registration: `BENCH-${String(index).padStart(3, "0")}`,
          vehicleType: "Van",
          status: "on_route",
          driverId,
          stale: false,
        },
        route: points,
        cumulative,
        totalDistance: total,
        distanceAlong: 0,
        segmentIndex: 0,
        sequenceNo: 0,
        lastCapturedAt: now,
      });
      this.drivers.set(driverId, {
        id: driverId,
        fullName: `Bench Driver ${index}`,
        status: "on_route",
        vehicleId: id,
        lastPingAt: now,
      });
      this.benchmarkVehicles += 1;
    }
    return this.benchmarkVehicles;
  }

  clearBenchmarkVehicles(): void {
    for (const id of [...this.vehicles.keys()]) {
      if (id.startsWith("bench-")) {
        this.vehicles.delete(id);
      }
    }
    for (const id of [...this.drivers.keys()]) {
      if (id.startsWith("bench-driver-")) {
        this.drivers.delete(id);
      }
    }
    this.benchmarkVehicles = 0;
  }

  fleetState(): FleetState {
    const now = Date.now();
    const vehicles: VehicleDto[] = [...this.vehicles.values()].map((record) => {
      const point = record.dto.location ?? record.route[0];
      const stale = now - Date.parse(record.lastCapturedAt) > STALE_AFTER_MS;
      return {
        ...record.dto,
        location: point ? { latitude: point.latitude, longitude: point.longitude } : undefined,
        stale,
      };
    });
    const routes = [...this.vehicles.entries()].map(([vehicleId, record]) => ({
      vehicleId,
      driverId: record.dto.driverId,
      points: record.route.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    }));
    const publishedPlan =
      this.lastRun && this.lastRun.published ? this.lastRun : undefined;
    return {
      tenantId: DEMO_TENANT_ID,
      scenario: this.scenario,
      demoMode: true,
      drivers: [...this.drivers.values()],
      vehicles,
      jobs: [...this.jobs.values()].map((j) => j.dto),
      alerts: this.alerts,
      serviceZones: this.serviceZones,
      routes,
      serverTime: new Date().toISOString(),
      ...(publishedPlan ? { publishedPlan } : {}),
    };
  }
}






