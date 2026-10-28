/**
 * Fleet-wide optimisation (docs/10): one VROOM solve over all eligible
 * vehicles and pending shipments, persisted as a proposal; approval
 * publishes every affected route in one transaction against the current
 * fleet version, or publishes nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  FleetOptimizationProposal,
  GeoPoint,
  LiveProposalStop,
} from "@privatefleet/contracts";
import { EVENT_SCHEMA_VERSION } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";
import {
  planFleet,
  type ShipmentInput,
  type SingleJobInput,
  type VehicleInput,
} from "../routing/plan.js";
import type { RoutingClients } from "../routing/types.js";
import { OptimizationError } from "./service.js";

const ENGINE = "osrm+vroom";
const ENGINE_VERSION = "2";
const DATASET_VERSION = process.env.ROUTING_DATASET_ID ?? "unconfigured";

interface FleetRouteRecord {
  driverId: string;
  vehicleId: string;
  driverName: string;
  stops: LiveProposalStop[];
  geometry: GeoPoint[];
  distanceMetres: number;
  durationSeconds: number;
  jobIds: string[];
}

interface FleetStoredResult {
  kind: "fleet";
  scope: "fleet" | "subset";
  expectedRouteVersion: number;
  datasetVersion: string;
  engineVersion: string;
  matrixSize: number;
  vehicleCount: number;
  shipmentCount: number;
  singleStopJobCount: number;
  totalDistanceMetres: number;
  totalDurationSeconds: number;
  inputHash: string;
  vehicles: FleetRouteRecord[];
  unassigned: Array<{ jobId: string; reason?: string }>;
  assignments: Array<{ jobId: string; driverId: string | null; status: string }>;
  published?: { version: number; routeIds: string[]; publishedAt: string };
}

interface DriverVehicleRow {
  driver_id: string;
  full_name: string;
  vehicle_id: string;
  capacity_units: number | null;
  required_capabilities: string[] | null;
  latitude: number | null;
  longitude: number | null;
}

interface EligibleStopRow {
  job_id: string;
  reference: string;
  status: string;
  assigned_driver_id: string | null;
  stop_id: string;
  stop_type: "pickup" | "dropoff";
  sequence: number;
  address: string;
  latitude: number;
  longitude: number;
  window_start: Date | string;
  window_end: Date | string;
  required_capabilities: string[] | null;
  service_seconds: number | null;
}

interface JobGroup {
  jobId: string;
  reference: string;
  status: string;
  assignedDriverId: string | null;
  pickup?: EligibleStopRow;
  dropoff?: EligibleStopRow;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function inList(ids: string[]) {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface FleetProposalOptions {
  driverIds?: string[];
}

export async function createFleetProposal(
  handle: DbHandle,
  clients: RoutingClients,
  tenantId: string,
  options: FleetProposalOptions = {},
): Promise<FleetOptimizationProposal> {
  return withTenant(handle, tenantId, async (db) => {
    const versionRows = (await db.execute(sql`
      SELECT coalesce(max(version), 1) AS current
      FROM routes WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')
    `)) as unknown as Array<{ current: number }>;
    const expectedRouteVersion = Number(versionRows[0]?.current ?? 1);

    const selected = options.driverIds?.length ? options.driverIds : null;
    const vehicleRows = (await db.execute(sql`
      SELECT d.id AS driver_id, d.full_name, v.id AS vehicle_id,
             v.capacity_units, v.required_capabilities, v.latitude, v.longitude
      FROM drivers d
      JOIN vehicles v ON v.id = d.vehicle_id
      ${selected ? sql`WHERE d.id IN (${inList(selected)})` : sql``}
      ORDER BY d.full_name
    `)) as unknown as DriverVehicleRow[];

    const stopRows = (await db.execute(sql`
      SELECT j.id AS job_id, j.reference, j.status, j.assigned_driver_id,
             js.id AS stop_id, js.stop_type, js.sequence, js.address,
             js.latitude, js.longitude, js.window_start, js.window_end,
             j.required_capabilities, j.service_seconds
      FROM jobs j
      JOIN job_stops js ON js.job_id = j.id
      WHERE j.status IN ('unassigned', 'assigned')
        AND js.status = 'pending'
        ${selected ? sql`AND (j.assigned_driver_id IS NULL OR j.assigned_driver_id IN (${inList(selected)}))` : sql``}
      ORDER BY j.reference, js.sequence
    `)) as unknown as EligibleStopRow[];

    const jobs = new Map<string, JobGroup>();
    for (const row of stopRows) {
      const group: JobGroup = jobs.get(row.job_id) ?? {
        jobId: row.job_id,
        reference: row.reference,
        status: row.status,
        assignedDriverId: row.assigned_driver_id,
      };
      if (row.stop_type === "pickup") {
        group.pickup = row;
      } else {
        group.dropoff = row;
      }
      jobs.set(row.job_id, group);
    }

    const unassigned: Array<{ jobId: string; reason?: string }> = [];
    const paired: JobGroup[] = [];
    const singleStop: JobGroup[] = [];
    for (const group of jobs.values()) {
      if (group.pickup && group.dropoff) {
        paired.push(group);
      } else if (group.pickup ?? group.dropoff) {
        // A legitimate single-stop service job, not malformed work.
        singleStop.push(group);
      } else {
        unassigned.push({ jobId: group.jobId, reason: "MISSING_STOP" });
      }
    }
    if (paired.length === 0 && singleStop.length === 0) {
      throw new OptimizationError("NO_ASSIGNED_STOPS");
    }

    // Capacity constraints are enforced only when every selected vehicle has
    // a defined capacity; partial configuration is rejected rather than
    // silently ignored.
    const anyCapacity = vehicleRows.some((row) => row.capacity_units !== null);
    const allCapacity = vehicleRows.every((row) => row.capacity_units !== null);
    if (anyCapacity && !allCapacity) {
      throw new OptimizationError("CONSTRAINTS_INCOMPLETE");
    }
    const capacityMode = allCapacity && vehicleRows.length > 0;

    // VROOM cannot enforce skills on paired shipments (it rejects skills
    // there), so paired work requiring capabilities is only planned when
    // every candidate vehicle has them; otherwise it is explicitly
    // unassigned instead of risking an invalid assignment.
    const vehicleSkills = vehicleRows.map((row) => row.required_capabilities ?? []);
    const hasSkillOnEveryVehicle = (required: string[]): boolean =>
      required.every((skill) => vehicleSkills.every((skills) => skills.includes(skill)));

    const pairedEligible: JobGroup[] = [];
    for (const group of paired) {
      const required = group.pickup!.required_capabilities ?? [];
      if (required.length > 0 && !hasSkillOnEveryVehicle(required)) {
        unassigned.push({ jobId: group.jobId, reason: "MISSING_SKILL" });
      } else if (capacityMode && Math.max(...vehicleRows.map((row) => row.capacity_units ?? 0)) < 1) {
        unassigned.push({ jobId: group.jobId, reason: "CAPACITY_EXCEEDED" });
      } else {
        pairedEligible.push(group);
      }
    }
    if (pairedEligible.length === 0 && singleStop.length === 0) {
      throw new OptimizationError("PLAN_INFEASIBLE");
    }

    const shipments: ShipmentInput[] = pairedEligible.map((group) => ({
      id: group.jobId,
      pickup: {
        latitude: Number(group.pickup!.latitude),
        longitude: Number(group.pickup!.longitude),
      },
      dropoff: {
        latitude: Number(group.dropoff!.latitude),
        longitude: Number(group.dropoff!.longitude),
      },
      pickupWindow: [iso(group.pickup!.window_start), iso(group.pickup!.window_end)],
      deliveryWindow: [iso(group.dropoff!.window_start), iso(group.dropoff!.window_end)],
    }));

    const singleJobs: SingleJobInput[] = singleStop.map((group) => {
      const stop = (group.pickup ?? group.dropoff)!;
      return {
        id: group.jobId,
        location: { latitude: Number(stop.latitude), longitude: Number(stop.longitude) },
        ...(stop.service_seconds !== null ? { serviceSeconds: stop.service_seconds } : {}),
        timeWindow: [iso(stop.window_start), iso(stop.window_end)],
        ...(stop.required_capabilities?.length
          ? { skills: stop.required_capabilities }
          : {}),
        ...(capacityMode ? { amount: [1] } : {}),
      };
    });

    // Depot: current vehicle position, else the first pending pickup of a job
    // currently assigned to that driver. Vehicles with neither are excluded.
    const firstPickupByDriver = new Map<string, GeoPoint>();
    for (const group of [...paired, ...singleStop]) {
      const stop = group.pickup ?? group.dropoff;
      if (group.assignedDriverId && stop) {
        if (!firstPickupByDriver.has(group.assignedDriverId)) {
          firstPickupByDriver.set(group.assignedDriverId, {
            latitude: Number(stop.latitude),
            longitude: Number(stop.longitude),
          });
        }
      }
    }

    const vehicles: VehicleInput[] = [];
    const vehicleMeta = new Map<
      number,
      { driverId: string; vehicleId: string; driverName: string }
    >();
    for (const [index, row] of vehicleRows.entries()) {
      const depot: GeoPoint | undefined =
        row.latitude !== null && row.longitude !== null
          ? { latitude: Number(row.latitude), longitude: Number(row.longitude) }
          : firstPickupByDriver.get(row.driver_id);
      if (!depot) {
        continue;
      }
      const id = index;
      vehicles.push({
        id,
        depot,
        ...(capacityMode ? { capacity: [row.capacity_units ?? 0] } : {}),
        ...(row.required_capabilities?.length
          ? { skills: row.required_capabilities }
          : {}),
      });
      vehicleMeta.set(id, {
        driverId: row.driver_id,
        vehicleId: row.vehicle_id,
        driverName: row.full_name,
      });
    }
    if (vehicles.length === 0) {
      throw new OptimizationError("NO_ASSIGNED_STOPS");
    }

    const request = {
      engine: ENGINE,
      engineVersion: ENGINE_VERSION,
      datasetVersion: DATASET_VERSION,
      // Bump when persisted fleet-result semantics change; old cached results
      // must never be served as valid proposals.
      resultSchemaVersion: 2,
      scope: selected ? "subset" : "fleet",
      expectedRouteVersion,
      vehicles,
      shipments,
      jobs: singleJobs,
      constraints: {
        capacityMode,
        singleStopJobCount: singleJobs.length,
      },
      // Assignment state is part of cache identity: a reassigned job must
      // not reuse an older proposal.
      assignments: [...pairedEligible, ...singleStop].map((group) => ({
        jobId: group.jobId,
        driverId: group.assignedDriverId,
        status: group.status,
      })),
    };
    const inputHash = hash(request);

    const cached = (await db.execute(sql`
      SELECT id, result FROM optimization_runs
      WHERE tenant_id = ${tenantId} AND input_hash = ${inputHash}
        AND status = 'succeeded' AND result->>'kind' = 'fleet'
      ORDER BY created_at DESC LIMIT 1
    `)) as unknown as Array<{ id: string; result: FleetStoredResult | null }>;
    if (cached[0]?.result) {
      return fleetProposal(cached[0].id, cached[0].result);
    }

    const plan = await planFleet(clients, { vehicles, shipments, jobs: singleJobs });

    const routes: FleetRouteRecord[] = [];
    for (const planned of plan.vehicles) {
      const meta = vehicleMeta.get(planned.vehicleId);
      if (!meta) {
        throw new OptimizationError("PLAN_INFEASIBLE");
      }
      const stops: LiveProposalStop[] = [];
      let arrivalIndex = 0;
      for (const unit of planned.orderedUnits) {
        if (unit.kind === "shipment") {
          const group = pairedEligible.find((candidate) => candidate.jobId === unit.id);
          if (!group?.pickup || !group.dropoff) {
            throw new OptimizationError("PLAN_INFEASIBLE");
          }
          const pickupArrival = planned.stopArrivals[arrivalIndex];
          const deliveryArrival = planned.stopArrivals[arrivalIndex + 1];
          stops.push(
            {
              jobId: unit.id,
              jobRef: group.reference,
              stopId: group.pickup.stop_id,
              stopType: "pickup",
              address: group.pickup.address,
              ...(pickupArrival && pickupArrival > 1_000_000_000
                ? { arrivalAt: new Date(pickupArrival * 1000).toISOString() }
                : {}),
            },
            {
              jobId: unit.id,
              jobRef: group.reference,
              stopId: group.dropoff.stop_id,
              stopType: "dropoff",
              address: group.dropoff.address,
              ...(deliveryArrival && deliveryArrival > 1_000_000_000
                ? { arrivalAt: new Date(deliveryArrival * 1000).toISOString() }
                : {}),
            },
          );
          arrivalIndex += 2;
        } else {
          const group = singleStop.find((candidate) => candidate.jobId === unit.id);
          const stop = group?.pickup ?? group?.dropoff;
          if (!group || !stop) {
            throw new OptimizationError("PLAN_INFEASIBLE");
          }
          const arrival = planned.stopArrivals[arrivalIndex];
          stops.push({
            jobId: unit.id,
            jobRef: group.reference,
            stopId: stop.stop_id,
            stopType: "service",
            address: stop.address,
            ...(arrival && arrival > 1_000_000_000
              ? { arrivalAt: new Date(arrival * 1000).toISOString() }
              : {}),
          });
          arrivalIndex += 1;
        }
      }
      routes.push({
        ...meta,
        stops,
        geometry: planned.geometry,
        distanceMetres: planned.distanceMetres,
        durationSeconds: planned.durationSeconds,
        jobIds: planned.orderedUnits.map((unit) => unit.id),
      });
    }

    const stored: FleetStoredResult = {
      kind: "fleet",
      scope: selected ? "subset" : "fleet",
      expectedRouteVersion,
      datasetVersion: DATASET_VERSION,
      engineVersion: ENGINE_VERSION,
      matrixSize: plan.matrixSize,
      vehicleCount: vehicles.length,
      shipmentCount: shipments.length,
      singleStopJobCount: singleJobs.length,
      totalDistanceMetres: routes.reduce((sum, route) => sum + route.distanceMetres, 0),
      totalDurationSeconds: routes.reduce((sum, route) => sum + route.durationSeconds, 0),
      inputHash,
      vehicles: routes,
      unassigned: [
        ...unassigned,
        ...plan.unassigned.map((jobId) => ({
          jobId,
          reason: plan.unassignedReasons.get(jobId) ?? "SOLVER_UNASSIGNED",
        })),
      ],
      assignments: [...pairedEligible, ...singleStop].map((group) => ({
        jobId: group.jobId,
        driverId: group.assignedDriverId,
        status: group.status,
      })),
    };

    const inserted = (await db.execute(sql`
      INSERT INTO optimization_runs
        (tenant_id, input_hash, engine, engine_version, request, result, metrics,
         status, started_at, finished_at)
      VALUES
        (${tenantId}, ${inputHash}, ${ENGINE}, ${ENGINE_VERSION},
         ${JSON.stringify(request)}::jsonb, ${JSON.stringify(stored)}::jsonb,
         ${JSON.stringify({
           vehicleCount: stored.vehicleCount,
           shipmentCount: stored.shipmentCount,
           matrixSize: stored.matrixSize,
           distanceMetres: routes.reduce((sum, route) => sum + route.distanceMetres, 0),
           durationSeconds: routes.reduce((sum, route) => sum + route.durationSeconds, 0),
           unassignedCount: stored.unassigned.length,
         })}::jsonb,
         'succeeded', now(), now())
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const runId = inserted[0]?.id;
    if (!runId) {
      throw new OptimizationError("RUN_NOT_READY");
    }
    return fleetProposal(runId, stored);
  });
}

function fleetProposal(runId: string, result: FleetStoredResult): FleetOptimizationProposal {
  return {
    runId,
    demoMode: false,
    engine: ENGINE,
    engineVersion: result.engineVersion,
    status: "succeeded",
    scope: result.scope,
    published: Boolean(result.published),
    ...(result.published ? { publishedAt: result.published.publishedAt } : {}),
    ...(result.published ? { publishedVersion: result.published.version } : {}),
    inputHash: result.inputHash,
    expectedRouteVersion: result.expectedRouteVersion,
    matrixSize: result.matrixSize,
    vehicleCount: result.vehicleCount,
    shipmentCount: result.shipmentCount,
    singleStopJobCount: result.singleStopJobCount,
    totalDistanceMetres: result.totalDistanceMetres,
    totalDurationSeconds: result.totalDurationSeconds,
    vehicles: result.vehicles.map((route) => ({
      driverId: route.driverId,
      vehicleId: route.vehicleId,
      driverName: route.driverName,
      stops: route.stops,
      geometry: route.geometry,
      distanceMetres: route.distanceMetres,
      durationSeconds: route.durationSeconds,
    })),
    unassigned: result.unassigned,
    datasetVersion: result.datasetVersion,
  };
}

export interface FleetApprovalResult {
  version: number;
  routeIds: string[];
  publishedAt: string;
}

export async function approveFleetProposal(
  handle: DbHandle,
  tenantId: string,
  runId: string,
  expectedRouteVersion?: number,
): Promise<FleetApprovalResult> {
  return withTenant(handle, tenantId, async (db) => {
    const runs = (await db.execute(sql`
      SELECT id, result FROM optimization_runs
      WHERE tenant_id = ${tenantId} AND id = ${runId} AND status = 'succeeded'
      FOR UPDATE
    `)) as unknown as Array<{ id: string; result: FleetStoredResult | null }>;
    const run = runs[0];
    if (!run?.result || run.result.kind !== "fleet") {
      throw new OptimizationError("RUN_NOT_FOUND");
    }
    const stored = run.result;
    if (stored.published) {
      return {
        version: stored.published.version,
        routeIds: stored.published.routeIds,
        publishedAt: stored.published.publishedAt,
      };
    }

    const versionRows = (await db.execute(sql`
      SELECT coalesce(max(version), 1) AS current
      FROM routes WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')
    `)) as unknown as Array<{ current: number }>;
    const current = Number(versionRows[0]?.current ?? 1);
    const expected = expectedRouteVersion ?? stored.expectedRouteVersion;
    if (expected !== current) {
      throw new OptimizationError("ROUTE_VERSION_STALE");
    }

    // The assignment state must still match what the solver saw.
    const jobIds = stored.assignments.map((entry) => entry.jobId);
    const currentRows = (await db.execute(sql`
      SELECT id, assigned_driver_id, status FROM jobs
      WHERE tenant_id = ${tenantId} AND id IN (${inList(jobIds)})
    `)) as unknown as Array<{
      id: string;
      assigned_driver_id: string | null;
      status: string;
    }>;
    const currentById = new Map(currentRows.map((row) => [row.id, row]));
    for (const snapshot of stored.assignments) {
      const now = currentById.get(snapshot.jobId);
      if (!now || now.assigned_driver_id !== snapshot.driverId || now.status !== snapshot.status) {
        throw new OptimizationError("ROUTE_VERSION_STALE");
      }
    }

    const nextVersion = current + 1;
    const publishedAt = new Date().toISOString();
    const routeIds: string[] = [];
    const vehicleIds = stored.vehicles.map((route) => route.vehicleId);

    await db.execute(sql`
      UPDATE routes SET status = 'superseded'
      WHERE tenant_id = ${tenantId} AND status = 'published'
        AND vehicle_id IN (${inList(vehicleIds)})
    `);

    for (const route of stored.vehicles) {
      const inserted = (await db.execute(sql`
        INSERT INTO routes
          (tenant_id, route_date, driver_id, vehicle_id, status, version,
           planned_distance_m, planned_duration_s, geometry, published_at)
        VALUES
          (${tenantId}, current_date, ${route.driverId}, ${route.vehicleId}, 'published',
           ${nextVersion}, ${Math.round(route.distanceMetres)}, ${Math.round(route.durationSeconds)},
           ${JSON.stringify(route.geometry)}::jsonb, now())
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      const routeId = inserted[0]?.id;
      if (!routeId) {
        throw new OptimizationError("RUN_NOT_READY");
      }
      routeIds.push(routeId);

      for (const [index, stop] of route.stops.entries()) {
        await db.execute(sql`
          INSERT INTO route_stops (tenant_id, route_id, job_stop_id, sequence_no)
          VALUES (${tenantId}, ${routeId}, ${stop.stopId}, ${index + 1})
        `);
      }

      for (const jobId of route.jobIds) {
        await db.execute(sql`
          UPDATE jobs
          SET assigned_driver_id = ${route.driverId},
              assigned_vehicle_id = ${route.vehicleId},
              status = CASE WHEN status = 'unassigned' THEN 'assigned'::job_status ELSE status END
          WHERE tenant_id = ${tenantId} AND id = ${jobId}
        `);
      }

      const envelope = {
        eventId: randomUUID(),
        schemaVersion: EVENT_SCHEMA_VERSION,
        tenantId,
        aggregateType: "route",
        aggregateId: routeId,
        type: "route.published",
        occurredAt: publishedAt,
        payload: {
          routeId,
          version: nextVersion,
          driverId: route.driverId,
          distanceMetres: route.distanceMetres,
          durationSeconds: route.durationSeconds,
          fleetPlan: true,
        },
      };
      await db.execute(sql`
        INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
        VALUES (${tenantId}, 'route', ${routeId}, 'route.published', ${JSON.stringify(envelope)}::jsonb)
      `);
    }

    const publishedResult: FleetStoredResult = {
      ...stored,
      published: { version: nextVersion, routeIds, publishedAt },
    };
    await db.execute(sql`
      UPDATE optimization_runs
      SET route_ids = ${JSON.stringify(routeIds)}::jsonb,
          result = ${JSON.stringify(publishedResult)}::jsonb,
          finished_at = now()
      WHERE id = ${runId}
    `);

    return { version: nextVersion, routeIds, publishedAt };
  });
}

// Keep the type import referenced for consumers of this module.
export type { FleetStoredResult };





