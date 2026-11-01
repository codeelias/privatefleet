/**
 * Read-only cost-aware assignment recommendations for the dispatcher.
 * Produces advisory suggestions only; it never assigns work.
 */
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";
import { effectivePolicy, getDispatchPolicy } from "./policy-service.js";
import {
  buildRecommendations,
  routeCostPence,
  type Economics,
  type Recommendation,
  type RouteCandidate,
  type UnassignedJobCandidate,
} from "./recommendations.js";

export interface RecommendationResponse {
  generatedAt: string;
  economics: Economics;
  routes: Array<{
    driverId: string;
    driverName: string;
    registration: string;
    distanceMetres: number;
    durationSeconds: number;
    estimatedCostPence: number;
  }>;
  recommendations: Recommendation[];
}

function economics(): Economics {
  return {
    fuelPencePerKm: Number(process.env.FUEL_PENCE_PER_KM ?? 12),
    vehiclePencePerKm: Number(process.env.VEHICLE_PENCE_PER_KM ?? 8),
    driverPencePerHour: Number(process.env.DRIVER_PENCE_PER_HOUR ?? 1500),
    maxDetourKm: Number(process.env.RECOMMEND_MAX_DETOUR_KM ?? 4),
  };
}

export async function getAssignmentRecommendations(
  handle: DbHandle,
  tenantId: string,
): Promise<RecommendationResponse> {
  const policy = await getDispatchPolicy(handle, tenantId);
  const rates = economics();

  return withTenant(handle, tenantId, async (db) => {
    const jobRows = (await db.execute(sql`
      SELECT j.id, j.reference, j.priority, js.stop_type, js.latitude, js.longitude
      FROM jobs j
      JOIN job_stops js ON js.job_id = j.id
      WHERE j.tenant_id = ${tenantId}
        AND j.status = 'unassigned'
        AND js.status = 'pending'
      ORDER BY j.reference, js.sequence
    `)) as unknown as Array<{
      id: string;
      reference: string;
      priority: string;
      stop_type: string;
      latitude: number;
      longitude: number;
    }>;
    const jobsById = new Map<string, UnassignedJobCandidate>();
    for (const row of jobRows) {
      const job = jobsById.get(row.id) ?? {
        jobId: row.id,
        reference: row.reference,
        priority: row.priority,
        pickup: { latitude: 0, longitude: 0 },
        dropoff: { latitude: 0, longitude: 0 },
      };
      const point = { latitude: Number(row.latitude), longitude: Number(row.longitude) };
      if (row.stop_type === "pickup") job.pickup = point;
      if (row.stop_type === "dropoff") job.dropoff = point;
      jobsById.set(row.id, job);
    }
    const candidates = [...jobsById.values()].filter(
      (job) => job.pickup.latitude !== 0 && job.dropoff.latitude !== 0,
    );

    const routeRows = (await db.execute(sql`
      SELECT r.id, r.driver_id, r.vehicle_id, r.planned_distance_m,
             r.planned_duration_s, d.full_name, v.registration
      FROM routes r
      JOIN drivers d ON d.id = r.driver_id
      JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.tenant_id = ${tenantId}
        AND r.status IN ('published', 'in_progress')
        AND r.version = (
          SELECT max(r2.version) FROM routes r2
          WHERE r2.tenant_id = ${tenantId}
            AND r2.driver_id = r.driver_id
            AND r2.status IN ('published', 'in_progress')
        )
    `)) as unknown as Array<{
      id: string;
      driver_id: string;
      vehicle_id: string;
      planned_distance_m: number;
      planned_duration_s: number;
      full_name: string;
      registration: string;
    }>;

    const stopRows = (await db.execute(sql`
      SELECT rs.route_id, js.latitude, js.longitude
      FROM route_stops rs
      JOIN job_stops js ON js.id = rs.job_stop_id
      WHERE rs.tenant_id = ${tenantId}
      ORDER BY rs.route_id, rs.sequence_no
    `)) as unknown as Array<{
      route_id: string;
      latitude: number;
      longitude: number;
    }>;
    const stopsByRoute = new Map<string, Array<{ latitude: number; longitude: number }>>();
    for (const stop of stopRows) {
      const list = stopsByRoute.get(stop.route_id) ?? [];
      list.push({ latitude: Number(stop.latitude), longitude: Number(stop.longitude) });
      stopsByRoute.set(stop.route_id, list);
    }

    const routes: RouteCandidate[] = [];
    for (const row of routeRows) {
      const stops = stopsByRoute.get(row.id) ?? [];
      const policyForVehicle = effectivePolicy(policy, row.vehicle_id);
      routes.push({
        driverId: row.driver_id,
        driverName: row.full_name,
        vehicleId: row.vehicle_id,
        registration: row.registration,
        stops,
        distanceMetres: Number(row.planned_distance_m ?? 0),
        durationSeconds: Number(row.planned_duration_s ?? 0),
        stopCount: stops.length,
        limits: {
          maxDistanceM: policyForVehicle.maxDistanceM,
          maxTravelTimeS: policyForVehicle.maxTravelTimeS,
          maxWorkingDurationS: policyForVehicle.maxWorkingDurationS,
          maxVisits: policyForVehicle.maxVisits,
        },
      });
    }

    const recommendations = routes.flatMap((route) =>
      buildRecommendations(route, candidates, rates),
    );
    const seen = new Set<string>();
    const deduped = recommendations.filter((item) => {
      const key = `${item.jobId}:${item.driverId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      generatedAt: new Date().toISOString(),
      economics: rates,
      routes: routes.map((route) => ({
        driverId: route.driverId,
        driverName: route.driverName,
        registration: route.registration,
        distanceMetres: route.distanceMetres,
        durationSeconds: route.durationSeconds,
        estimatedCostPence: routeCostPence(
          route.distanceMetres,
          route.durationSeconds,
          rates,
        ),
      })),
      recommendations: deduped
        .sort((a, b) => a.addedCostPence - b.addedCostPence)
        .slice(0, 12),
    };
  });
}
