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
  JobStopDto,
  VehicleDto,
} from "@privatefleet/contracts";
import { EVENT_SCHEMA_VERSION } from "@privatefleet/contracts";
import type { RealtimeBus } from "../../lib/realtime.js";
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
      | "IDEMPOTENCY_CONFLICT",
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
}

interface RouteRow {
  vehicle_id: string;
  driver_id: string | null;
  version: number;
  geometry: Array<{ latitude: number; longitude: number }> | null;
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

  async snapshot(tenantId: string): Promise<FleetState> {
    return withTenant(this.handle, tenantId, async (db) => {
      const jobs = (await db.execute(
        sql`SELECT id, reference, service_type, priority, status, assigned_driver_id,
                   assigned_vehicle_id, version
            FROM jobs ORDER BY reference`,
      )) as unknown as JobRow[];
      const stops = (await db.execute(
        sql`SELECT id, job_id, sequence, stop_type, address, latitude, longitude, status,
                   window_start, window_end, arrived_at, completed_at
            FROM job_stops ORDER BY job_id, sequence`,
      )) as unknown as StopRow[];
      const drivers = (await db.execute(
        sql`SELECT id, full_name, status, vehicle_id, last_ping_at FROM drivers ORDER BY full_name`,
      )) as unknown as DriverRow[];
      const vehicles = (await db.execute(
        sql`SELECT id, registration, vehicle_type, status, driver_id, latitude, longitude, captured_at
            FROM vehicles ORDER BY registration`,
      )) as unknown as VehicleRow[];
      const alerts = (await db.execute(
        sql`SELECT id, severity, status, title, entity, location, freshness,
                   recommended_action, created_at
            FROM alerts ORDER BY created_at DESC`,
      )) as unknown as AlertRow[];

      const routeRows = (await db.execute(sql`
        SELECT vehicle_id, driver_id, version, geometry
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
      const routePaths = [...latestByVehicle.values()]
        .filter((row) => Array.isArray(row.geometry) && row.geometry.length >= 2)
        .map((row) => ({
          vehicleId: row.vehicle_id,
          ...(row.driver_id ? { driverId: row.driver_id } : {}),
          points: row.geometry as Array<{ latitude: number; longitude: number }>,
          version: Number(row.version),
        }));
      const routeVersion =
        routeRows.length > 0
          ? Math.max(...routeRows.map((row) => Number(row.version)))
          : 1;

      const stopsByJob = new Map<string, JobStopDto[]>();
      for (const stop of stops) {
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
      await db.execute(
        sql`UPDATE job_stops SET status = 'completed', completed_at = now() WHERE id = ${stopId}`,
      );
      const jobStatus = await this.resolveJobStatus(db, jobId);
      await this.eventAndOutbox(db, tenantId, jobId, actorId, "job.completed", {
        jobId,
        stopId,
        driverId,
        ...details,
      });
      return { stopId, status: "completed", jobStatus };
    });
  }

  async skip(
    tenantId: string,
    actorId: string,
    jobId: string,
    stopId: string,
    driverId: string,
    reason: string,
    idempotencyKey: string | undefined,
  ): Promise<{ stopId: string; status: string; jobStatus: string }> {
    return this.idempotent(tenantId, idempotencyKey, "POST /v1/jobs/:id/stops/:id/skip", async (db) => {
      const stop = await this.requireStop(db, jobId, stopId, driverId);
      if (stop.status === "completed" || stop.status === "skipped") {
        throw new FleetError("INVALID_STOP_TRANSITION");
      }
      await db.execute(
        sql`UPDATE job_stops SET status = 'skipped', completed_at = now() WHERE id = ${stopId}`,
      );
      const jobStatus = await this.resolveJobStatus(db, jobId);
      await this.eventAndOutbox(db, tenantId, jobId, actorId, "job.skipped", {
        jobId,
        stopId,
        driverId,
        reason,
      });
      return { stopId, status: "skipped", jobStatus };
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
              freshness, recommended_action, created_at`,
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








