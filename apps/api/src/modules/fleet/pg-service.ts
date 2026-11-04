/**
 * Phase 2 fleet service: server-authoritative job lifecycle over
 * Postgres with RLS, command idempotency and a transactional outbox
 * (docs/04.5, docs/08, ADR-0008). Same response shapes as the demo
 * module so the existing clients work unchanged.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  AlertDto,
  AssignmentPreview,
  AssignResponse,
  DriverDto,
  EventEnvelope,
  FleetState,
  JobDto,
  JobImportPreview,
  JobStopDto,
  ImportJob,
  RouteLeg,
  RoutePath,
  RouteWaypoint,
  VehicleDto,
} from "@privatefleet/contracts";
import {
  EVENT_SCHEMA_VERSION,
  FAILURE_REASON_CODES,
  type FailureReasonCode,
} from "@privatefleet/contracts";

const FAILURE_REASON_LABELS: Record<FailureReasonCode, string> = {
  RECIPIENT_UNAVAILABLE: "Recipient unavailable",
  DELIVERY_REFUSED: "Delivery refused",
  ADDRESS_ACCESS_PROBLEM: "Address or access problem",
  ITEM_DAMAGED: "Item damaged",
  VEHICLE_OPERATIONAL_PROBLEM: "Vehicle or operational problem",
  OTHER: "Delivery exception",
};
import type { RealtimeBus } from "../../lib/realtime.js";
import { scoreDelivery } from "./delivery-confidence.js";
import {
  buildImportCandidates,
  candidateToJob,
  ImportError,
  validateImportJobs,
  type ImportCandidate,
  type ImportServiceArea,
} from "../import/csv.js";
import { withTenant, type Database, type DbHandle } from "../../db/client.js";

export class FleetError extends Error {
  constructor(
    readonly code:
      | "JOB_OR_DRIVER_NOT_FOUND"
      | "JOB_ASSIGNMENT_CONFLICT"
      | "DRIVER_HAS_NO_VEHICLE"
      | "STOP_NOT_FOUND"
      | "STOP_NOT_ASSIGNED_TO_DRIVER"
      | "INVALID_STOP_TRANSITION"
      | "ALERT_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "EVIDENCE_REQUIRED"
      | "EVIDENCE_ALREADY_RECORDED"
      | "FAILURE_REASON_INVALID"
  ) {
    super(code);
  }
}

interface JobRow {
  id: string;
  reference: string;
  service_type: string;
  priority: "standard" | "urgent" | "stat";
  status: JobDto["status"];
  assigned_driver_id: string | null;
  assigned_vehicle_id: string | null;
  version: number;
}

interface StopRow {
  id: string;
  job_id: string;
  sequence_no: number;
  stop_type: "pickup" | "dropoff";
  address: string;
  latitude: number;
  longitude: number;
  status: JobStopDto["status"];
  window_start: Date | string | null;
  window_end: Date | string | null;
  arrived_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
  failure_note: string | null;
  evidence_kinds: string[] | null;
  gps_gap_m: number | null;
}

interface DriverRow {
  id: string;
  full_name: string;
  status: DriverDto["status"];
  vehicle_id: string | null;
  last_ping_at: Date | string | null;
}

interface VehicleRow {
  id: string;
  registration: string;
  vehicle_type: string;
  status: VehicleDto["status"];
  driver_id: string | null;
  latitude: number | null;
  longitude: number | null;
  captured_at: Date | string | null;
  accuracy_metres: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  source: string | null;
  satellites_used: number | null;
  dual_frequency: boolean | null;
  carrier_phase: boolean | null;
  ekf_confidence: string | null;
  rtk_state: string | null;
  correction_age_ms: number | null;
  movement_state: string | null;
}

interface RouteRow {
  vehicle_id: string;
  driver_id: string | null;
  version: number;
  geometry: Array<{ latitude: number; longitude: number }> | null;
  waypoints: unknown[] | null;
  legs: unknown[] | null;
}

interface AlertRow {
  id: string;
  severity: AlertDto["severity"];
  status: "open" | "acknowledged" | "resolved";
  title: string;
  entity: string;
  location: string;
  freshness: string;
  recommended_action: string;
  job_id: string | null;
  stop_id: string | null;
  created_at: Date | string;
}

const STALE_AFTER_MS = 60_000;

function iso(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : value.toISOString();
}

function epoch(value: Date | string | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

export class PgFleetService {
  constructor(
    private readonly handle: DbHandle,
    private readonly bus: RealtimeBus,
  ) {}

  async snapshot(
    tenantId: string,
    options: { includeRoutes?: boolean } = {},
  ): Promise<FleetState> {
    return withTenant(this.handle, tenantId, async (db) => {
      const jobs = (await db.execute(
        sql`SELECT id, reference, service_type, priority, status, assigned_driver_id,
                   assigned_vehicle_id, version
            FROM jobs ORDER BY reference`,
      )) as unknown as JobRow[];
      const stops = (await db.execute(
        sql`SELECT s.id, s.job_id, s.sequence, s.stop_type, s.address, s.latitude, s.longitude, s.status,
                   s.window_start, s.window_end, s.arrived_at, s.completed_at, s.failure_code, s.failure_note,
                   ev.kinds AS evidence_kinds,
                   CASE WHEN s.completed_at IS NULL THEN NULL ELSE (
                     SELECT MIN(ST_Distance(
                       ST_MakePoint(lp.longitude, lp.latitude)::geography,
                       ST_MakePoint(s.longitude, s.latitude)::geography))
                     FROM location_points lp
                     JOIN jobs j2 ON j2.assigned_vehicle_id = lp.vehicle_id
                     WHERE j2.id = s.job_id
                       AND lp.captured_at BETWEEN s.completed_at - interval '5 minutes'
                                              AND s.completed_at + interval '2 minutes'
                   ) END AS gps_gap_m
            FROM job_stops s
            LEFT JOIN LATERAL (
              SELECT array_agg(DISTINCT kind) AS kinds FROM stop_evidence WHERE stop_id = s.id
            ) ev ON true
            ORDER BY s.job_id, s.sequence`,
      )) as unknown as StopRow[];
      const drivers = (await db.execute(
        sql`SELECT id, full_name, status, vehicle_id, last_ping_at FROM drivers ORDER BY full_name`,
      )) as unknown as DriverRow[];
      const vehicles = (await db.execute(
        sql`SELECT v.id, v.registration, v.vehicle_type, v.status, v.driver_id, v.latitude, v.longitude, v.captured_at,
                   lp.accuracy_metres, lp.heading_deg, lp.speed_mps,
                   lp.source, lp.satellites_used, lp.dual_frequency, lp.carrier_phase, lp.ekf_confidence,
                   lp.rtk_state, lp.correction_age_ms, lp.movement_state
            FROM vehicles v
            LEFT JOIN LATERAL (
              SELECT accuracy_metres, heading_deg, speed_mps, source,
                     satellites_used, dual_frequency, carrier_phase, ekf_confidence,
                     rtk_state, correction_age_ms, movement_state
              FROM location_points
              WHERE vehicle_id = v.id
              ORDER BY captured_at DESC
              LIMIT 1
            ) lp ON true
            ORDER BY v.registration`,
      )) as unknown as VehicleRow[];
      const alerts = (await db.execute(
        sql`SELECT id, severity, status, title, entity, location, freshness,
                   recommended_action, job_id, stop_id, created_at
            FROM alerts ORDER BY created_at DESC`,
      )) as unknown as AlertRow[];

      const includeRoutes = options.includeRoutes !== false;
      const routeRows = (await db.execute(sql`
        SELECT vehicle_id, driver_id, version
               ${includeRoutes ? sql`, geometry, waypoints, legs` : sql``}
        FROM routes
        WHERE status IN ('published', 'in_progress')
        ORDER BY version DESC
      `)) as unknown as RouteRow[];
      const latestByVehicle = new Map<string, RouteRow>();
      for (const row of routeRows) {
        if (!latestByVehicle.has(row.vehicle_id)) {
          latestByVehicle.set(row.vehicle_id, row);
        }
      }
      const routePaths = includeRoutes
        ? [...latestByVehicle.values()]
            .filter((row) => Array.isArray(row.geometry) && row.geometry.length >= 2)
            .map((row) => ({
              vehicleId: row.vehicle_id,
              ...(row.driver_id ? { driverId: row.driver_id } : {}),
              points: row.geometry as Array<{ latitude: number; longitude: number }>,
              version: Number(row.version),
              ...(Array.isArray(row.waypoints) ? { waypoints: row.waypoints as RouteWaypoint[] } : {}),
              ...(Array.isArray(row.legs) ? { legs: row.legs as RouteLeg[] } : {}),
            }))
        : [];
      const routeVersion =
        routeRows.length > 0
          ? Math.max(...routeRows.map((row) => Number(row.version)))
          : 1;

      const stopsByJob = new Map<string, JobStopDto[]>();
      for (const stop of stops) {
        const terminal = stop.status === "completed" || stop.status === "skipped" || stop.status === "failed";
        const confidence = terminal
          ? scoreDelivery({
              photo:
                (stop.evidence_kinds?.includes("photo") ?? false) ||
                (stop.evidence_kinds?.includes("failure_photo") ?? false),
              signature: stop.evidence_kinds?.includes("signature") ?? false,
              gpsWithinTolerance:
                stop.gps_gap_m !== null && stop.gps_gap_m <= 200,
              withinWindow:
                stop.completed_at !== null &&
                stop.window_end !== null &&
                epoch(stop.completed_at) <= epoch(stop.window_end),
              failureCode: stop.failure_code,
            })
          : undefined;
        const list = stopsByJob.get(stop.job_id) ?? [];
        list.push({
          id: stop.id,
          jobId: stop.job_id,
          sequenceNo: stop.sequence_no,
          stopType: stop.stop_type,
          address: stop.address,
          location: { latitude: stop.latitude, longitude: stop.longitude },
          status: stop.status,
          ...(iso(stop.window_start) ? { windowStart: iso(stop.window_start) } : {}),
          ...(iso(stop.window_end) ? { windowEnd: iso(stop.window_end) } : {}),
          ...(iso(stop.arrived_at) ? { arrivedAt: iso(stop.arrived_at) } : {}),
          ...(iso(stop.completed_at) ? { completedAt: iso(stop.completed_at) } : {}),
          ...(stop.failure_code ? { failureCode: stop.failure_code } : {}),
          ...(stop.failure_note ? { failureNote: stop.failure_note } : {}),
          ...(confidence ? { deliveryConfidence: confidence } : {}),
        });
        stopsByJob.set(stop.job_id, list);
      }

      return {
        tenantId,
        demoMode: false,
        drivers: drivers.map((driver) => ({
          id: driver.id,
          fullName: driver.full_name,
          status: driver.status,
          ...(driver.vehicle_id ? { vehicleId: driver.vehicle_id } : {}),
          ...(iso(driver.last_ping_at) ? { lastPingAt: iso(driver.last_ping_at) } : {}),
        })),
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle.id,
          registration: vehicle.registration,
          vehicleType: vehicle.vehicle_type,
          status: vehicle.status,
          ...(vehicle.driver_id ? { driverId: vehicle.driver_id } : {}),
          ...(vehicle.latitude !== null && vehicle.longitude !== null
            ? {
                location: { latitude: vehicle.latitude, longitude: vehicle.longitude },
              }
            : {}),
          stale:
            !vehicle.captured_at ||
            Date.now() - epoch(vehicle.captured_at) > STALE_AFTER_MS,
          locationStatus:
            vehicle.latitude === null || vehicle.longitude === null
              ? "unknown"
              : !vehicle.captured_at ||
                  Date.now() - epoch(vehicle.captured_at) > STALE_AFTER_MS
                ? "stale"
                : "live",
          ...(iso(vehicle.captured_at) ? { lastSeenAt: iso(vehicle.captured_at) } : {}),
          ...(vehicle.accuracy_metres !== null ? { accuracyMetres: vehicle.accuracy_metres } : {}),
          ...(vehicle.heading_deg !== null ? { headingDeg: vehicle.heading_deg } : {}),
          ...(vehicle.speed_mps !== null ? { speedMps: vehicle.speed_mps } : {}),
          ...(vehicle.source
            ? { positionSource: vehicle.source as VehicleDto["positionSource"] }
            : {}),
          ...(vehicle.satellites_used !== null ? { satellitesUsed: vehicle.satellites_used } : {}),
          ...(vehicle.dual_frequency !== null ? { dualFrequency: vehicle.dual_frequency } : {}),
          ...(vehicle.carrier_phase !== null ? { carrierPhase: vehicle.carrier_phase } : {}),
          ...(vehicle.ekf_confidence
            ? { ekfConfidence: vehicle.ekf_confidence as VehicleDto["ekfConfidence"] }
            : {}),
          ...(vehicle.rtk_state
            ? { rtkState: vehicle.rtk_state as VehicleDto["rtkState"] }
            : {}),
          ...(vehicle.correction_age_ms !== null
            ? { correctionAgeMs: vehicle.correction_age_ms }
            : {}),
          ...(vehicle.movement_state
            ? { movementState: vehicle.movement_state as VehicleDto["movementState"] }
            : {}),
        })),
        jobs: jobs.map((job) => ({
          id: job.id,
          reference: job.reference,
          serviceType: job.service_type,
          priority: job.priority,
          status: job.status,
          stops: stopsByJob.get(job.id) ?? [],
          ...(job.assigned_driver_id ? { assignedDriverId: job.assigned_driver_id } : {}),
          ...(job.assigned_vehicle_id ? { assignedVehicleId: job.assigned_vehicle_id } : {}),
          version: job.version,
        })),
        alerts: alerts.map((alert) => ({
          id: alert.id,
          severity: alert.severity,
          title: alert.title,
          entity: alert.entity,
          location: alert.location,
          freshness: alert.freshness,
          recommendedAction: alert.recommended_action,
          ...(alert.job_id ? { relatedJobId: alert.job_id } : {}),
          ...(alert.stop_id ? { relatedStopId: alert.stop_id } : {}),
          createdAt: iso(alert.created_at) ?? new Date().toISOString(),
          acknowledged: alert.status !== "open",
          audit: [],
        })),
        serviceZones: [],
        routes: routePaths,
        routeVersion,
        serverTime: new Date().toISOString(),
      };
    });
  }


  async routes(tenantId: string): Promise<{ routes: RoutePath[]; routeVersion: number }> {
    return withTenant(this.handle, tenantId, async (db) => {
      const rows = (await db.execute(sql`
        SELECT vehicle_id, driver_id, version, geometry, waypoints, legs
        FROM routes
        WHERE status IN ('published', 'in_progress')
        ORDER BY version DESC
      `)) as unknown as RouteRow[];
      const latestByVehicle = new Map<string, RouteRow>();
      for (const row of rows) {
        if (!latestByVehicle.has(row.vehicle_id)) {
          latestByVehicle.set(row.vehicle_id, row);
        }
      }
      const routes = [...latestByVehicle.values()]
        .filter((row) => Array.isArray(row.geometry) && row.geometry.length >= 2)
        .map((row) => ({
          vehicleId: row.vehicle_id,
          ...(row.driver_id ? { driverId: row.driver_id } : {}),
          points: row.geometry as Array<{ latitude: number; longitude: number }>,
          version: Number(row.version),
          ...(Array.isArray(row.waypoints) ? { waypoints: row.waypoints as RouteWaypoint[] } : {}),
          ...(Array.isArray(row.legs) ? { legs: row.legs as RouteLeg[] } : {}),
        }));
      const routeVersion =
        rows.length > 0 ? Math.max(...rows.map((row) => Number(row.version))) : 1;
      return { routes, routeVersion };
    });
  }
  async previewAssignment(
    tenantId: string,
    jobId: string,
    driverId: string,
  ): Promise<AssignmentPreview> {
    return withTenant(this.handle, tenantId, async (db) => {
      const jobRows = (await db.execute(
        sql`SELECT id, reference, status FROM jobs WHERE id = ${jobId}`,
      )) as unknown as Array<{ id: string; reference: string; status: JobDto["status"] }>;
      const driverRows = (await db.execute(
        sql`SELECT id, status FROM drivers WHERE id = ${driverId}`,
      )) as unknown as Array<{ id: string; status: DriverDto["status"] }>;
      const job = jobRows[0];
      const driver = driverRows[0];
      if (!job || !driver) {
        throw new FleetError("JOB_OR_DRIVER_NOT_FOUND");
      }
      const constraints: string[] = [];
      if (job.status !== "unassigned") {
        constraints.push("Job is already assigned");
      }
      if (driver.status === "suspended" || driver.status === "off_duty") {
        constraints.push("Driver is not on shift");
      }

      const downstream = (await db.execute(
        sql`SELECT s.address FROM job_stops s
            JOIN jobs j ON j.id = s.job_id
            WHERE j.assigned_driver_id = ${driverId} AND s.status = 'pending'
            ORDER BY s.sequence`,
      )) as unknown as Array<{ address: string }>;
      const newStops = (await db.execute(
        sql`SELECT address FROM job_stops WHERE job_id = ${jobId} AND status = 'pending'
            ORDER BY sequence`,
      )) as unknown as Array<{ address: string }>;

      const pendingStops = downstream.length + newStops.length;
      const etaImpactMinutes = 3 + Math.min(pendingStops, 12) * 2;
      const etaCascade = [...downstream, ...newStops].map((stop) => ({
        address: stop.address,
        arrivalDeltaMinutes: etaImpactMinutes,
      }));

      return {
        jobId,
        driverId,
        demoMode: false,
        etaImpactMinutes,
        message:
          constraints.length > 0
            ? `Cannot assign yet: ${constraints.join("; ")}.`
            : `Estimated +${etaImpactMinutes} min; ${etaCascade.length} stop(s) downstream.`,
        constraintsViolated: constraints,
        etaCascade,
      };
    });
  }

  async assign(
    tenantId: string,
    actorId: string,
    jobId: string,
    driverId: string,
    idempotencyKey: string,
  ): Promise<AssignResponse> {
    return this.idempotent(tenantId, idempotencyKey, "POST /v1/jobs/:id/assign", async (db) => {
      const jobRows = (await db.execute(
        sql`SELECT id, status, assigned_driver_id FROM jobs WHERE id = ${jobId}`,
      )) as unknown as Array<{
        id: string;
        status: JobDto["status"];
        assigned_driver_id: string | null;
      }>;
      const driverRows = (await db.execute(
        sql`SELECT id, status, vehicle_id FROM drivers WHERE id = ${driverId}`,
      )) as unknown as Array<{
        id: string;
        status: DriverDto["status"];
        vehicle_id: string | null;
      }>;
      const job = jobRows[0];
      const driver = driverRows[0];
      if (!job || !driver) {
        throw new FleetError("JOB_OR_DRIVER_NOT_FOUND");
      }
      if (job.status !== "unassigned") {
        throw new FleetError("JOB_ASSIGNMENT_CONFLICT");
      }
      if (!driver.vehicle_id) {
        throw new FleetError("DRIVER_HAS_NO_VEHICLE");
      }
      if (driver.status === "suspended" || driver.status === "off_duty") {
        throw new FleetError("JOB_OR_DRIVER_NOT_FOUND");
      }

      const pending = (await db.execute(
        sql`SELECT count(*)::int AS count FROM job_stops WHERE job_id = ${jobId} AND status = 'pending'`,
      )) as unknown as Array<{ count: number }>;
      const etaImpactMinutes = 3 + Math.min(pending[0]?.count ?? 0, 12) * 2;

      const updated = (await db.execute(
        sql`UPDATE jobs SET status = 'assigned', assigned_driver_id = ${driverId},
              assigned_vehicle_id = ${driver.vehicle_id}, version = version + 1, updated_at = now()
            WHERE id = ${jobId} AND status = 'unassigned'
            RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      if (updated.length === 0) {
        throw new FleetError("JOB_ASSIGNMENT_CONFLICT");
      }
      await db.execute(
        sql`UPDATE vehicles SET status = 'on_route' WHERE id = ${driver.vehicle_id}`,
      );
      await db.execute(
        sql`UPDATE drivers SET status = 'on_route' WHERE id = ${driverId}`,
      );
      await db.execute(sql`
        INSERT INTO job_events (tenant_id, job_id, type, actor_type, actor_id, payload)
        VALUES (${tenantId}, ${jobId}, 'job.assigned', 'user', ${actorId},
          ${JSON.stringify({ driverId, etaImpactMinutes })}::jsonb)
      `);
      const event = this.outboxEvent(tenantId, "job", jobId, "job.assigned", {
        jobId,
        driverId,
        vehicleId: driver.vehicle_id,
        etaImpactMinutes,
      });
      await this.insertOutbox(db, tenantId, event);

      return {
        jobId,
        driverId,
        vehicleId: driver.vehicle_id,
        status: "assigned" as const,
        etaImpactMinutes,
      };
    });
  }

  async arrive(
    tenantId: string,
    actorId: string,
    jobId: string,
    stopId: string,
    driverId: string,
    idempotencyKey: string | undefined,
  ): Promise<{ stopId: string; status: string }> {
    return this.idempotent(tenantId, idempotencyKey, "POST /v1/jobs/:id/stops/:id/arrive", async (db) => {
      const rows = (await db.execute(
        sql`SELECT s.id, s.status, j.assigned_driver_id
            FROM job_stops s JOIN jobs j ON j.id = s.job_id
            WHERE s.id = ${stopId} AND s.job_id = ${jobId}`,
      )) as unknown as Array<{
        id: string;
        status: string;
        assigned_driver_id: string | null;
      }>;
      const stop = rows[0];
      if (!stop) {
        throw new FleetError("STOP_NOT_FOUND");
      }
      if (stop.assigned_driver_id !== driverId) {
        throw new FleetError("STOP_NOT_ASSIGNED_TO_DRIVER");
      }
      if (stop.status !== "pending") {
        throw new FleetError("INVALID_STOP_TRANSITION");
      }
      await db.execute(
        sql`UPDATE job_stops SET status = 'arrived', arrived_at = now() WHERE id = ${stopId}`,
      );
      await db.execute(
        sql`UPDATE jobs SET status = 'in_progress', version = version + 1, updated_at = now()
            WHERE id = ${jobId} AND status = 'assigned'`,
      );
      await this.eventAndOutbox(db, tenantId, jobId, actorId, "job.arrived", {
        jobId,
        stopId,
        driverId,
      });
      await this.advanceRouteLifecycle(db, tenantId, actorId, stopId);
      return { stopId, status: "arrived" };
    });
  }

  async complete(
    tenantId: string,
    actorId: string,
    jobId: string,
    stopId: string,
    driverId: string,
    details: { recipientName?: string | undefined; notes?: string | undefined },
    idempotencyKey: string | undefined,
  ): Promise<{ stopId: string; status: string; jobStatus: string }> {
    return this.idempotent(tenantId, idempotencyKey, "POST /v1/jobs/:id/stops/:id/complete", async (db) => {
      const stop = await this.requireStop(db, jobId, stopId, driverId);
      if (stop.status !== "arrived" && stop.status !== "pending") {
        throw new FleetError("INVALID_STOP_TRANSITION");
      }

      const contextRows = (await db.execute(
        sql`SELECT j.service_type FROM jobs j WHERE j.id = ${jobId}`,
      )) as unknown as Array<{ service_type: string }>;
      const policy = await this.resolvePolicy(db, tenantId, contextRows[0]?.service_type ?? "*");
      const evidence = (await db.execute(
        sql`SELECT id, kind, content_hash FROM stop_evidence WHERE stop_id = ${stopId}`,
      )) as unknown as Array<{ id: string; kind: string; content_hash: string }>;
      const kinds = new Set(evidence.map((item) => item.kind));

      if (policy.requireRecipient && !details.recipientName?.trim()) {
        throw new FleetError("EVIDENCE_REQUIRED");
      }
      if (policy.requireSignature && !kinds.has("signature")) {
        throw new FleetError("EVIDENCE_REQUIRED");
      }
      if (policy.requirePhoto && !kinds.has("photo")) {
        throw new FleetError("EVIDENCE_REQUIRED");
      }

      await db.execute(
        sql`UPDATE job_stops SET status = 'completed', completed_at = now() WHERE id = ${stopId}`,
      );
      const jobStatus = await this.resolveJobStatus(db, jobId);
      await this.eventAndOutbox(db, tenantId, jobId, actorId, "job.completed", {
        jobId,
        stopId,
        driverId,
        ...details,
        proofPolicy: policy,
        evidence: evidence.map((item) => ({
          id: item.id,
          kind: item.kind,
          contentHash: item.content_hash,
        })),
      });
      await this.advanceRouteLifecycle(db, tenantId, actorId, stopId);
      return { stopId, status: "completed", jobStatus };
    });
  }

  async skip(
    tenantId: string,
    actorId: string,
    jobId: string,
    stopId: string,
    driverId: string,
    failure: { reasonCode: FailureReasonCode; note?: string | undefined },
    idempotencyKey: string | undefined,
  ): Promise<{ stopId: string; status: string; jobStatus: string; failureCode: FailureReasonCode }> {
    return this.idempotent(tenantId, idempotencyKey, "POST /v1/jobs/:id/stops/:id/skip", async (db) => {
      const stop = await this.requireStop(db, jobId, stopId, driverId);
      if (stop.status === "completed" || stop.status === "skipped") {
        throw new FleetError("INVALID_STOP_TRANSITION");
      }
      const contextRows = (await db.execute(
        sql`SELECT s.address, j.service_type FROM job_stops s
            JOIN jobs j ON j.id = s.job_id
            WHERE s.id = ${stopId} AND s.job_id = ${jobId}`,
      )) as unknown as Array<{ address: string; service_type: string }>;
      const context = contextRows[0];
      if (!context) throw new FleetError("STOP_NOT_FOUND");
      const policy = await this.resolvePolicy(db, tenantId, context.service_type);
      const failureEvidence = (await db.execute(
        sql`SELECT id, kind, content_hash FROM stop_evidence
            WHERE stop_id = ${stopId} AND kind = 'failure_photo'`,
      )) as unknown as Array<{ id: string; kind: string; content_hash: string }>;
      if (policy.requireFailurePhoto && failureEvidence.length === 0) {
        throw new FleetError("EVIDENCE_REQUIRED");
      }

      const failureCode = FAILURE_REASON_CODES.includes(failure.reasonCode)
        ? failure.reasonCode
        : "OTHER";
      await db.execute(
        sql`UPDATE job_stops
            SET status = 'skipped', completed_at = now(),
                failure_code = ${failureCode}, failure_note = ${failure.note ?? null}
            WHERE id = ${stopId}`,
      );
      const jobStatus = await this.resolveJobStatus(db, jobId);
      await this.eventAndOutbox(db, tenantId, jobId, actorId, "job.skipped", {
        jobId,
        stopId,
        driverId,
        reasonCode: failureCode,
        reasonLabel: FAILURE_REASON_LABELS[failureCode],
        ...(failure.note ? { note: failure.note } : {}),
        evidence: failureEvidence.map((item) => ({
          id: item.id,
          kind: item.kind,
          contentHash: item.content_hash,
        })),
      });

      await this.advanceRouteLifecycle(db, tenantId, actorId, stopId);

      const alertId = randomUUID();
      const jobReference = (await db.execute(
        sql`SELECT reference FROM jobs WHERE id = ${jobId}`,
      )) as unknown as Array<{ reference: string }>;
      const reference = jobReference[0]?.reference ?? jobId;
      const severity = failureCode === "ITEM_DAMAGED" || failureCode === "DELIVERY_REFUSED"
        ? "urgent"
        : "at_risk";
      await db.execute(sql`
        INSERT INTO alerts
          (id, tenant_id, severity, status, title, entity, location, freshness,
           recommended_action, reference, job_id, stop_id)
        VALUES
          (${alertId}, ${tenantId}, ${severity}, 'open',
           ${`${FAILURE_REASON_LABELS[failureCode]} - ${reference}`},
           ${`Job ${reference}`}, ${context.address},
           ${`Reported ${new Date().toISOString()}`},
           'Review the evidence, contact the customer, then retry, reschedule or return to depot.',
           ${reference}, ${jobId}, ${stopId})
      `);
      await this.insertOutbox(
        db,
        tenantId,
        this.outboxEvent(tenantId, "alert", alertId, "alert.created", {
          alertId,
          jobId,
          stopId,
          reasonCode: failureCode,
        }),
      );
      return { stopId, status: "skipped", jobStatus, failureCode };
    });
  }

  async actOnAlert(
    tenantId: string,
    alertId: string,
    actorId: string,
    action: "acknowledge" | "resolve",
    idempotencyKey: string | undefined,
  ): Promise<AlertDto> {
    return this.idempotent(tenantId, idempotencyKey, `POST /v1/alerts/:id/${action}`, async (db) => {
      const nextStatus = action === "acknowledge" ? "acknowledged" : "resolved";
      const rows = (await db.execute(
        sql`UPDATE alerts SET status = ${nextStatus}, acted_at = now()
            WHERE id = ${alertId} RETURNING id, severity, status, title, entity, location,
              freshness, recommended_action, job_id, stop_id, created_at`,
      )) as unknown as AlertRow[];
      const alert = rows[0];
      if (!alert) {
        throw new FleetError("ALERT_NOT_FOUND");
      }
      await this.insertOutbox(
        db,
        tenantId,
        this.outboxEvent(tenantId, "alert", alertId, `alert.${action}d`, {
          alertId,
          actorId,
        }),
      );
      return {
        id: alert.id,
        severity: alert.severity,
        title: alert.title,
        entity: alert.entity,
        location: alert.location,
        freshness: alert.freshness,
        recommendedAction: alert.recommended_action,
        createdAt: iso(alert.created_at) ?? new Date().toISOString(),
        acknowledged: true,
        audit: [
          {
            at: new Date().toISOString(),
            message: `${action}d by ${actorId}`,
          },
        ],
      };
    });
  }

  /** Validate CSV into a preview without writing jobs. */
  async importPreview(
    tenantId: string,
    csv: string,
    area: ImportServiceArea,
  ): Promise<JobImportPreview> {
    return withTenant(this.handle, tenantId, async (db) => {
      const candidates = buildImportCandidates(csv);
      await this.applyImportArea(db, candidates, area);
      await this.applyImportDuplicates(db, candidates);
      const duplicateCount = candidates.filter((candidate) =>
        candidate.errors.some((error) => error === "Job reference already exists."),
      ).length;
      const invalidCount = candidates.filter(
        (candidate) =>
          candidate.errors.length > 0 &&
          !candidate.errors.includes("Job reference already exists."),
      ).length;
      const validCount = candidates.length - duplicateCount - invalidCount;
      return {
        valid: validCount,
        invalid: invalidCount,
        duplicates: duplicateCount,
        canCommit: invalidCount === 0 && duplicateCount === 0,
        preview: candidates.map((candidate) => {
          const duplicate = candidate.errors.includes("Job reference already exists.");
          const invalid = candidate.errors.length > 0 && !duplicate;
          return {
            row: candidate.firstRow,
            jobRef: candidate.jobRef,
            stopCount: candidate.stops.length,
            address:
              candidate.stops
                .map((stop) => stop.address)
                .filter(Boolean)
                .join(" -> ") || "(no address)",
            status: duplicate ? "duplicate" : invalid ? "invalid" : "valid",
            errors: candidate.errors,
          } as const;
        }),
        jobs: candidates
          .filter((candidate) => candidate.errors.length === 0)
          .map(candidateToJob),
      };
    });
  }

  /** Atomically insert the validated preview payload. */
  async importCommit(
    tenantId: string,
    actorId: string,
    jobsInput: unknown,
    area: ImportServiceArea,
    idempotencyKey: string | undefined,
  ): Promise<{ imported: number; jobIds: string[]; references: string[] }> {
    return this.idempotent(
      tenantId,
      idempotencyKey,
      "POST /v1/jobs/import/commit",
      async (db) => {
        const jobs = validateImportJobs(jobsInput);
        const candidates = jobs.map((job) => this.importCandidate(job));
        await this.applyImportArea(db, candidates, area);
        await this.applyImportDuplicates(db, candidates);
        const duplicates = candidates.filter((candidate) =>
          candidate.errors.includes("Job reference already exists."),
        );
        if (duplicates.length > 0) {
          throw new ImportError(
            "IMPORT_DUPLICATES",
            `Duplicate job references: ${duplicates.map((candidate) => candidate.jobRef).join(", ")}`,
          );
        }
        const invalid = candidates.filter((candidate) => candidate.errors.length > 0);
        if (invalid.length > 0) {
          throw new ImportError(
            "IMPORT_VALIDATION_FAILED",
            invalid[0]!.errors[0] ?? "Import validation failed",
          );
        }

        const jobIds: string[] = [];
        const references: string[] = [];
        for (const candidate of candidates) {
          const jobId = randomUUID();
          await db.execute(sql`
            INSERT INTO jobs
              (id, tenant_id, reference, service_type, priority, status, version)
            VALUES
              (${jobId}, ${tenantId}, ${candidate.jobRef}, ${candidate.serviceType},
               ${candidate.priority}, 'unassigned', 0)
          `);
          for (const [stopIndex, stop] of candidate.stops.entries()) {
            await db.execute(sql`
              INSERT INTO job_stops
                (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude,
                 window_start, window_end, status)
              VALUES
                (${randomUUID()}, ${tenantId}, ${jobId}, ${stopIndex + 1}, ${stop.stopType},
                 ${stop.address}, ${stop.latitude}, ${stop.longitude},
                 ${stop.windowStart}, ${stop.windowEnd}, 'pending')
            `);
          }
          await this.eventAndOutbox(db, tenantId, jobId, actorId, "job.imported", {
            jobId,
            reference: candidate.jobRef,
            serviceType: candidate.serviceType,
            stopCount: candidate.stops.length,
          });
          jobIds.push(jobId);
          references.push(candidate.jobRef);
        }
        return { imported: jobIds.length, jobIds, references };
      },
    );
  }

  private importCandidate(job: ImportJob): ImportCandidate {
    const now = new Date();
    const defaultStart = now.toISOString();
    const defaultEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    return {
      firstRow: 1,
      jobRef: job.jobRef.trim(),
      serviceType: job.serviceType.trim(),
      priority: job.priority,
      errors: [],
      stops: job.stops.map((stop, index) => ({
        row: index + 2,
        stopType: stop.stopType,
        address: stop.address.trim(),
        latitude: stop.latitude,
        longitude: stop.longitude,
        windowStart: stop.windowStart ?? defaultStart,
        windowEnd: stop.windowEnd ?? defaultEnd,
      })),
    };
  }

  private async applyImportArea(
    db: Database,
    candidates: ImportCandidate[],
    area: ImportServiceArea,
  ): Promise<void> {
    const points = candidates.flatMap((candidate) =>
      candidate.stops
        .filter(
          (stop) =>
            stop.latitude !== null &&
            stop.longitude !== null &&
            stop.latitude >= -90 &&
            stop.latitude <= 90 &&
            stop.longitude >= -180 &&
            stop.longitude <= 180,
        )
        .map((stop) => ({
          key: `${candidate.jobRef}::${stop.row}`,
          latitude: stop.latitude,
          longitude: stop.longitude,
        })),
    );
    if (points.length === 0) return;
    const rows = (await db.execute(sql`
      SELECT item->>'key' AS key,
             ST_DWithin(
               ST_SetSRID(ST_MakePoint((item->>'longitude')::float8, (item->>'latitude')::float8), 4326)::geography,
               ST_SetSRID(ST_MakePoint(${area.longitude}, ${area.latitude}), 4326)::geography,
               ${area.radiusMeters}
             ) AS in_area
      FROM jsonb_array_elements(${JSON.stringify(points)}::jsonb) AS item
    `)) as unknown as Array<{ key: string; in_area: boolean }>;
    const outside = new Set(
      rows.filter((row) => !row.in_area).map((row) => row.key.split("::")[0]!),
    );
    for (const candidate of candidates) {
      if (outside.has(candidate.jobRef)) {
        candidate.errors.push("Address is outside the import service area.");
      }
    }
  }

  private async applyImportDuplicates(
    db: Database,
    candidates: ImportCandidate[],
  ): Promise<void> {
    const refs = [...new Set(candidates.map((candidate) => candidate.jobRef))];
    if (refs.length === 0) return;
    const rows = (await db.execute(
      sql`SELECT reference FROM jobs WHERE reference IN (${sql.join(
        refs.map((ref) => sql`${ref}`),
        sql`, `,
      )})`,
    )) as unknown as Array<{ reference: string }>;
    const existing = new Set(rows.map((row) => row.reference));
    for (const candidate of candidates) {
      if (existing.has(candidate.jobRef)) {
        candidate.errors.push("Job reference already exists.");
      }
    }
  }

  /** Tenant-scoped driver queue: only this driver's assigned jobs. */
  async driverQueue(
    tenantId: string,
    driverId: string,
  ): Promise<{ driver: DriverDto; jobs: JobDto[] }> {
    const state = await this.snapshot(tenantId);
    const driver = state.drivers.find((candidate) => candidate.id === driverId);
    if (!driver) {
      throw new FleetError("JOB_OR_DRIVER_NOT_FOUND");
    }
    return {
      driver,
      jobs: state.jobs.filter((job) => job.assignedDriverId === driverId),
    };
  }

  /** Driver starts a shift: driver and their vehicle go on route. */
  async startShift(tenantId: string, driverId: string): Promise<DriverDto> {
    return withTenant(this.handle, tenantId, async (db) => {
      const rows = (await db.execute(
        sql`UPDATE drivers SET status = 'on_route', last_ping_at = now()
            WHERE id = ${driverId}
            RETURNING id, tenant_id, full_name, status, vehicle_id, last_ping_at`,
      )) as unknown as Array<{
        id: string;
        tenant_id: string;
        full_name: string;
        status: DriverDto["status"];
        vehicle_id: string | null;
        last_ping_at: Date | string | null;
      }>;
      const driver = rows[0];
      if (!driver) {
        throw new FleetError("JOB_OR_DRIVER_NOT_FOUND");
      }
      if (driver.vehicle_id) {
        await db.execute(
          sql`UPDATE vehicles SET status = 'on_route' WHERE id = ${driver.vehicle_id}`,
        );
      }
      return {
        id: driver.id,
        fullName: driver.full_name,
        status: driver.status,
        ...(driver.vehicle_id ? { vehicleId: driver.vehicle_id } : {}),
        ...(driver.last_ping_at
          ? { lastPingAt: new Date(driver.last_ping_at).toISOString() }
          : {}),
      };
    });
  }

  // --- helpers ---------------------------------------------------------

  private async resolvePolicy(
    db: Database,
    tenantId: string,
    serviceType: string,
  ): Promise<{
    serviceType: string;
    requireRecipient: boolean;
    requireSignature: boolean;
    requirePhoto: boolean;
    requireFailurePhoto: boolean;
  }> {
    const rows = (await db.execute(
      sql`SELECT service_type, require_recipient, require_signature, require_photo,
                 require_failure_photo
          FROM proof_policies
          WHERE tenant_id = ${tenantId} AND service_type IN (${serviceType}, '*')
          ORDER BY CASE WHEN service_type = ${serviceType} THEN 0 ELSE 1 END
          LIMIT 1`,
    )) as unknown as Array<{
      service_type: string;
      require_recipient: boolean;
      require_signature: boolean;
      require_photo: boolean;
      require_failure_photo: boolean;
    }>;
    const row = rows[0];
    return row
      ? {
          serviceType: row.service_type,
          requireRecipient: row.require_recipient,
          requireSignature: row.require_signature,
          requirePhoto: row.require_photo,
          requireFailurePhoto: row.require_failure_photo,
        }
      : {
          serviceType: "*",
          requireRecipient: true,
          requireSignature: false,
          requirePhoto: false,
          requireFailurePhoto: false,
        };
  }

  private async requireStop(
    db: Database,
    jobId: string,
    stopId: string,
    driverId: string,
  ): Promise<{ id: string; status: string }> {
    const rows = (await db.execute(
      sql`SELECT s.id, s.status, j.assigned_driver_id
          FROM job_stops s JOIN jobs j ON j.id = s.job_id
          WHERE s.id = ${stopId} AND s.job_id = ${jobId}`,
    )) as unknown as Array<{
      id: string;
      status: string;
      assigned_driver_id: string | null;
    }>;
    const stop = rows[0];
    if (!stop) {
      throw new FleetError("STOP_NOT_FOUND");
    }
    if (stop.assigned_driver_id !== driverId) {
      throw new FleetError("STOP_NOT_ASSIGNED_TO_DRIVER");
    }
    return { id: stop.id, status: stop.status };
  }

  private async advanceRouteLifecycle(
    db: Database,
    tenantId: string,
    actorId: string,
    stopId: string,
  ): Promise<void> {
    const rows = (await db.execute(sql`
      SELECT r.id, r.driver_id,
        (SELECT count(*)::int
         FROM route_stops rs2
         JOIN job_stops js2 ON js2.id = rs2.job_stop_id
         WHERE rs2.route_id = r.id
           AND js2.status NOT IN ('completed', 'skipped', 'failed')) AS open_stops
      FROM routes r
      JOIN route_stops rs ON rs.route_id = r.id
      WHERE rs.job_stop_id = ${stopId}
        AND r.status IN ('published', 'in_progress')
    `)) as unknown as Array<{ id: string; driver_id: string; open_stops: number }>;

    for (const route of rows) {
      const open = Number(route.open_stops);
      const nextStatus = open === 0 ? "completed" : "in_progress";
      await db.execute(sql`
        UPDATE routes SET status = ${nextStatus}
        WHERE id = ${route.id} AND status IN ('published', 'in_progress')
      `);
      if (open === 0) {
        await db.execute(sql`
          UPDATE drivers d SET status = 'available'
          WHERE d.id = ${route.driver_id}
            AND d.status = 'on_route'
            AND NOT EXISTS (
              SELECT 1 FROM routes r
              WHERE r.driver_id = d.id
                AND r.status IN ('published', 'in_progress')
            )
        `);
        await db.execute(sql`
          INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
          VALUES (
            ${tenantId}, 'route', ${route.id}, 'route.completed',
            ${JSON.stringify({
              routeId: route.id,
              driverId: route.driver_id,
              closedBy: actorId,
              triggerStopId: stopId,
            })}::jsonb
          )
        `);
      }
    }
  }

  private async resolveJobStatus(
    db: Database,
    jobId: string,
  ): Promise<string> {
    const rows = (await db.execute(
      sql`SELECT
            count(*) FILTER (WHERE status = 'pending')::int AS pending,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            count(*) FILTER (WHERE status = 'skipped')::int AS skipped
          FROM job_stops WHERE job_id = ${jobId}`,
    )) as unknown as Array<{ pending: number; completed: number; skipped: number }>;
    const counts = rows[0] ?? { pending: 0, completed: 0, skipped: 0 };
    const next =
      counts.pending > 0
        ? "in_progress"
        : counts.completed > 0
          ? "completed"
          : "skipped";
    await db.execute(
      sql`UPDATE jobs SET status = ${next}, version = version + 1, updated_at = now() WHERE id = ${jobId}`,
    );
    return next;
  }

  private async eventAndOutbox(
    db: Database,
    tenantId: string,
    jobId: string,
    actorId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO job_events (tenant_id, job_id, type, actor_type, actor_id, payload)
      VALUES (${tenantId}, ${jobId}, ${type}, 'user', ${actorId}, ${JSON.stringify(payload)}::jsonb)
    `);
    await this.insertOutbox(
      db,
      tenantId,
      this.outboxEvent(tenantId, "job", jobId, type, payload),
    );
  }

  private outboxEvent(
    tenantId: string,
    aggregateType: string,
    aggregateId: string,
    type: string,
    payload: Record<string, unknown>,
  ): EventEnvelope {
    return {
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId,
      aggregateType,
      aggregateId,
      type,
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  private async insertOutbox(
    db: Database,
    tenantId: string,
    event: EventEnvelope,
  ): Promise<void> {
    await db.execute(sql`
      INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${tenantId}, ${event.aggregateType}, ${event.aggregateId}, ${event.type},
        ${JSON.stringify(event)}::jsonb)
    `);
  }

  /**
   * Runs a command once per idempotency key; replays return the stored
   * response. The check and the write share one tenant transaction.
   */
  private async idempotent<T>(
    tenantId: string,
    idempotencyKey: string | undefined,
    endpoint: string,
    work: (db: Database) => Promise<T>,
  ): Promise<T> {
    if (!idempotencyKey) {
      return withTenant(this.handle, tenantId, work);
    }
    return withTenant(this.handle, tenantId, async (db) => {
      const existing = (await db.execute(
        sql`SELECT response, status_code FROM idempotency_keys
            WHERE tenant_id = ${tenantId} AND key = ${idempotencyKey}`,
      )) as unknown as Array<{ response: T; status_code: number }>;
      const hit = existing[0];
      if (hit) {
        return hit.response;
      }
      const result = await work(db);
      await db.execute(sql`
        INSERT INTO idempotency_keys (tenant_id, key, endpoint, request_hash, status_code, response)
        VALUES (${tenantId}, ${idempotencyKey}, ${endpoint}, ${"v1"},
          ${200}, ${JSON.stringify(result)}::jsonb)
        ON CONFLICT (tenant_id, key) DO NOTHING
      `);
      return result;
    });
  }

  /** Publishes outbox rows written by this service (post-commit). */
  async publishPending(tenantId: string): Promise<void> {
    const rows = (await this.handle.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx`SELECT id, payload FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 50`;
    })) as unknown as Array<{ id: string; payload: EventEnvelope }>;
    for (const row of rows) {
      this.bus.publishBusiness(row.payload);
      await withTenant(this.handle, tenantId, async (db) => {
        await db.execute(
          sql`UPDATE outbox SET published_at = now() WHERE id = ${row.id}`,
        );
      });
    }
  }
}

















