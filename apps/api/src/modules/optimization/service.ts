/**
 * Phase 5 optimization service (docs/10): build a validated proposal from
 * OSRM/VROOM, persist the run (every claim traceable), cache identical
 * inputs, and publish an approved route version transactionally with
 * stale-version rejection.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { GeoPoint, LiveOptimizationProposal, LiveProposalStop } from "@privatefleet/contracts";
import { EVENT_SCHEMA_VERSION } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";
import { planShipments, type ShipmentInput } from "../routing/plan.js";
import { RoutingError, type RoutingClients } from "../routing/types.js";

export type OptimizationErrorCode =
  | "DRIVER_NOT_FOUND"
  | "NO_ASSIGNED_STOPS"
  | "PLAN_INFEASIBLE"
  | "RUN_NOT_FOUND"
  | "RUN_NOT_READY"
  | "ROUTE_VERSION_STALE"
  | "CONSTRAINTS_INCOMPLETE"
  | "ROUTING_INVALID_RESPONSE";

export class OptimizationError extends Error {
  constructor(
    readonly code: OptimizationErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

interface DriverRow {
  driver_id: string;
  full_name: string;
  vehicle_id: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface StopRow {
  job_id: string;
  reference: string;
  stop_id: string;
  stop_type: "pickup" | "dropoff";
  sequence: number;
  address: string;
  latitude: number;
  longitude: number;
  window_start: Date | string;
  window_end: Date | string;
}

interface StoredResult {
  driverId: string;
  driverName: string;
  inputHash: string;
  stops: LiveProposalStop[];
  geometry: GeoPoint[];
  unassigned: string[];
  distanceMetres: number;
  durationSeconds: number;
  matrixSize: number;
}

const ENGINE = "osrm+vroom";
const ENGINE_VERSION = "1";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function hashInputs(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function createProposal(
  handle: DbHandle,
  clients: RoutingClients,
  tenantId: string,
  driverId: string,
): Promise<LiveOptimizationProposal> {
  return withTenant(handle, tenantId, async (db) => {
    const drivers = (await db.execute(sql`
      SELECT d.id AS driver_id, d.full_name, d.vehicle_id, v.latitude, v.longitude
      FROM drivers d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.id = ${driverId}
      LIMIT 1
    `)) as unknown as DriverRow[];
    const driver = drivers[0];
    if (!driver) {
      throw new OptimizationError("DRIVER_NOT_FOUND");
    }

    const rows = (await db.execute(sql`
      SELECT j.id AS job_id, j.reference, js.id AS stop_id, js.stop_type, js.sequence,
             js.address, js.latitude, js.longitude, js.window_start, js.window_end
      FROM jobs j
      JOIN job_stops js ON js.job_id = j.id
      WHERE j.assigned_driver_id = ${driverId}
        AND j.status IN ('assigned', 'in_progress')
        AND js.status IN ('pending', 'arrived')
      ORDER BY j.reference, js.sequence
    `)) as unknown as StopRow[];

    const byJob = new Map<
      string,
      { reference: string; pickup?: StopRow; dropoff?: StopRow }
    >();
    for (const row of rows) {
      const entry = byJob.get(row.job_id) ?? { reference: row.reference };
      if (row.stop_type === "pickup") {
        entry.pickup = row;
      } else {
        entry.dropoff = row;
      }
      byJob.set(row.job_id, entry);
    }

    const complete = [...byJob.entries()].filter(
      (entry): entry is [string, { reference: string; pickup: StopRow; dropoff: StopRow }] =>
        Boolean(entry[1].pickup && entry[1].dropoff),
    );
    if (complete.length === 0) {
      throw new OptimizationError("NO_ASSIGNED_STOPS");
    }

    const shipments: ShipmentInput[] = complete.map(([jobId, entry]) => ({
      id: jobId,
      pickup: { latitude: Number(entry.pickup.latitude), longitude: Number(entry.pickup.longitude) },
      dropoff: {
        latitude: Number(entry.dropoff.latitude),
        longitude: Number(entry.dropoff.longitude),
      },
      pickupWindow: [iso(entry.pickup.window_start), iso(entry.pickup.window_end)],
      deliveryWindow: [iso(entry.dropoff.window_start), iso(entry.dropoff.window_end)],
    }));

    const depot: GeoPoint =
      driver.latitude !== null && driver.longitude !== null
        ? { latitude: Number(driver.latitude), longitude: Number(driver.longitude) }
        : shipments[0]!.pickup;

    const request = {
      engine: ENGINE,
      engineVersion: ENGINE_VERSION,
      vehicle: { id: 1, depot },
      shipments,
    };
    const inputHash = hashInputs(request);

    const cached = (await db.execute(sql`
      SELECT id, result, route_id FROM optimization_runs
      WHERE tenant_id = ${tenantId} AND input_hash = ${inputHash} AND status = 'succeeded'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Array<{ id: string; result: StoredResult | null }>;
    const cachedRun = cached[0];
    if (cachedRun?.result) {
      return toProposal(cachedRun.id, cachedRun.result, false);
    }

    const plan = await planShipments(clients, {
      vehicle: { id: 1, depot },
      shipments,
    });
    const planned = plan.vehicles[0];
    if (!planned) {
      throw new OptimizationError("PLAN_INFEASIBLE");
    }

    const stopByJob = new Map(complete);
    const stops: LiveProposalStop[] = [];
    for (const jobId of planned.orderedShipmentIds) {
      const entry = stopByJob.get(jobId);
      if (!entry) {
        throw new OptimizationError("PLAN_INFEASIBLE");
      }
      stops.push(
        {
          jobId,
          jobRef: entry.reference,
          stopId: entry.pickup.stop_id,
          stopType: "pickup",
          address: entry.pickup.address,
        },
        {
          jobId,
          jobRef: entry.reference,
          stopId: entry.dropoff.stop_id,
          stopType: "dropoff",
          address: entry.dropoff.address,
        },
      );
    }

    const stored: StoredResult = {
      driverId,
      driverName: driver.full_name,
      inputHash,
      stops,
      geometry: planned.geometry,
      unassigned: plan.unassigned,
      distanceMetres: planned.distanceMetres,
      durationSeconds: planned.durationSeconds,
      matrixSize: plan.matrixSize,
    };

    const inserted = (await db.execute(sql`
      INSERT INTO optimization_runs
        (tenant_id, input_hash, engine, engine_version, request, result, metrics,
         status, started_at, finished_at)
      VALUES
        (${tenantId}, ${inputHash}, ${ENGINE}, ${ENGINE_VERSION},
         ${JSON.stringify(request)}::jsonb, ${JSON.stringify(stored)}::jsonb,
         ${JSON.stringify({
           distanceMetres: stored.distanceMetres,
           durationSeconds: stored.durationSeconds,
           unassignedCount: stored.unassigned.length,
           matrixSize: stored.matrixSize,
         })}::jsonb,
         'succeeded', now(), now())
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const runId = inserted[0]?.id;
    if (!runId) {
      throw new OptimizationError("RUN_NOT_READY");
    }
    return toProposal(runId, stored, false);
  });
}

function toProposal(
  runId: string,
  result: StoredResult,
  published: boolean,
): LiveOptimizationProposal {
  return {
    runId,
    driverId: result.driverId,
    driverName: result.driverName,
    demoMode: false,
    engine: ENGINE,
    engineVersion: ENGINE_VERSION,
    status: "succeeded",
    published,
    inputHash: result.inputHash,
    matrixSize: result.matrixSize,
    proposal: {
      distanceMetres: result.distanceMetres,
      durationSeconds: result.durationSeconds,
      stops: result.stops,
      unassigned: result.unassigned,
      geometry: result.geometry,
    },
  };
}

export interface ApprovalResult {
  routeId: string;
  version: number;
  publishedAt: string;
}

export async function approveProposal(
  handle: DbHandle,
  tenantId: string,
  runId: string,
  expectedRouteVersion?: number,
): Promise<ApprovalResult> {
  return withTenant(handle, tenantId, async (db) => {
    const runs = (await db.execute(sql`
      SELECT id, route_id, result FROM optimization_runs
      WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'succeeded'
      FOR UPDATE
    `)) as unknown as Array<{ id: string; route_id: string | null; result: StoredResult | null }>;
    const run = runs[0];
    if (!run) {
      throw new OptimizationError("RUN_NOT_FOUND");
    }
    const result = run.result;
    if (!result || result.stops.length === 0) {
      throw new OptimizationError("RUN_NOT_READY");
    }

    if (run.route_id) {
      const existing = (await db.execute(sql`
        SELECT version, published_at FROM routes WHERE id = ${run.route_id}
      `)) as unknown as Array<{ version: number; published_at: Date | string | null }>;
      const route = existing[0];
      if (route?.published_at) {
        return {
          routeId: run.route_id,
          version: Number(route.version),
          publishedAt: iso(route.published_at),
        };
      }
    }

    const versionRows = (await db.execute(sql`
      SELECT coalesce(max(version), 1) AS current
      FROM routes
      WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')
    `)) as unknown as Array<{ current: number }>;
    const current = Number(versionRows[0]?.current ?? 1);
    if (expectedRouteVersion !== undefined && expectedRouteVersion !== current) {
      throw new OptimizationError("ROUTE_VERSION_STALE");
    }
    const nextVersion = current + 1;

    const driverAndVehicle = (await db.execute(sql`
      SELECT d.vehicle_id FROM drivers d WHERE d.id = ${result.driverId} LIMIT 1
    `)) as unknown as Array<{ vehicle_id: string | null }>;
    const vehicleId = driverAndVehicle[0]?.vehicle_id;
    if (!vehicleId) {
      throw new OptimizationError("DRIVER_NOT_FOUND");
    }

    const inserted = (await db.execute(sql`
      INSERT INTO routes
        (tenant_id, route_date, driver_id, vehicle_id, status, version,
         planned_distance_m, planned_duration_s, geometry, published_at)
      VALUES
        (${tenantId}, current_date, ${result.driverId}, ${vehicleId}, 'published', ${nextVersion},
         ${Math.round(result.distanceMetres)}, ${Math.round(result.durationSeconds)},
         ${JSON.stringify(result.geometry)}::jsonb, now())
      RETURNING id, published_at
    `)) as unknown as Array<{ id: string; published_at: Date | string }>;
    const route = inserted[0];
    if (!route) {
      throw new OptimizationError("RUN_NOT_READY");
    }

    await db.execute(sql`
      UPDATE routes SET status = 'superseded'
      WHERE tenant_id = ${tenantId} AND status = 'published' AND id <> ${route.id}
    `);

    const stopValues = result.stops.map((stop, index) => ({
      jobStopId: stop.stopId,
      sequenceNo: index + 1,
    }));
    for (const stop of stopValues) {
      await db.execute(sql`
        INSERT INTO route_stops (tenant_id, route_id, job_stop_id, sequence_no)
        VALUES (${tenantId}, ${route.id}, ${stop.jobStopId}, ${stop.sequenceNo})
      `);
    }

    await db.execute(sql`
      UPDATE optimization_runs SET route_id = ${route.id}, finished_at = now()
      WHERE id = ${runId}
    `);

    const envelope = {
      eventId: randomUUID(),
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId,
      aggregateType: "route",
      aggregateId: route.id,
      type: "route.published",
      occurredAt: new Date().toISOString(),
      payload: {
        routeId: route.id,
        version: nextVersion,
        driverId: result.driverId,
        distanceMetres: result.distanceMetres,
        durationSeconds: result.durationSeconds,
      },
    };
    await db.execute(sql`
      INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${tenantId}, 'route', ${route.id}, 'route.published', ${JSON.stringify(envelope)}::jsonb)
    `);

    return { routeId: route.id, version: nextVersion, publishedAt: iso(route.published_at) };
  });
}

export { RoutingError };



