/**
 * Explicit route closure: the dispatcher ends a published route that is no
 * longer operationally valid. Remaining work is returned to the unassigned
 * queue and the driver becomes available, with an audit event.
 */
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";

export class RouteCloseError extends Error {
  constructor(readonly code: "ROUTE_NOT_FOUND" | "ROUTE_NOT_OPEN") {
    super(code);
  }
}

export interface RouteCloseResult {
  routeId: string;
  driverId: string;
  version: number;
  freedJobs: number;
  status: "cancelled";
}

export async function closeRoute(
  handle: DbHandle,
  tenantId: string,
  vehicleId: string,
  version: number,
  reason = "Closed by dispatcher",
): Promise<RouteCloseResult> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      SELECT id, driver_id, status FROM routes
      WHERE tenant_id = ${tenantId}
        AND vehicle_id = ${vehicleId}
        AND version = ${version}
      FOR UPDATE
    `)) as unknown as Array<{ id: string; driver_id: string; status: string }>;
    const route = rows[0];
    if (!route) throw new RouteCloseError("ROUTE_NOT_FOUND");
    if (route.status !== "published" && route.status !== "in_progress") {
      throw new RouteCloseError("ROUTE_NOT_OPEN");
    }

    const openStops = (await db.execute(sql`
      SELECT js.id
      FROM route_stops rs
      JOIN job_stops js ON js.id = rs.job_stop_id
      WHERE rs.route_id = ${route.id}
        AND js.status NOT IN ('completed', 'skipped', 'failed')
    `)) as unknown as Array<{ id: string }>;

    const freed = (await db.execute(sql`
      WITH released AS (
        SELECT DISTINCT js.job_id
        FROM route_stops rs
        JOIN job_stops js ON js.id = rs.job_stop_id
        WHERE rs.route_id = ${route.id}
          AND js.status NOT IN ('completed', 'skipped', 'failed')
          AND NOT EXISTS (
            SELECT 1 FROM jobs j2
            WHERE j2.id = js.job_id AND j2.status IN ('completed', 'cancelled')
          )
      ), reset_stops AS (
        UPDATE job_stops
        SET status = 'pending', arrived_at = NULL
        WHERE id IN (
          SELECT js.id
          FROM route_stops rs
          JOIN job_stops js ON js.id = rs.job_stop_id
          WHERE rs.route_id = ${route.id}
            AND js.status NOT IN ('completed', 'skipped', 'failed')
            AND NOT EXISTS (
              SELECT 1 FROM jobs j2
              WHERE j2.id = js.job_id AND j2.status IN ('completed', 'cancelled')
            )
        )
        RETURNING job_id
      )
      UPDATE jobs j
      SET status = 'unassigned', assigned_driver_id = NULL
      WHERE j.id IN (SELECT job_id FROM released)
        AND j.status NOT IN ('completed', 'cancelled')
      RETURNING j.id
    `)) as unknown as Array<{ id: string }>;

    await db.execute(sql`
      UPDATE routes
      SET status = 'cancelled'
      WHERE id = ${route.id}
    `);

    await db.execute(sql`
      UPDATE drivers d
      SET status = 'available'
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
        ${tenantId},
        'route',
        ${route.id},
        'route.closed',
        ${JSON.stringify({
          reason,
          version,
          freedJobs: freed.length,
          openStops: openStops.length,
        })}::jsonb
      )
    `);

    return {
      routeId: route.id,
      driverId: route.driver_id,
      version,
      freedJobs: freed.length,
      status: "cancelled" as const,
    };
  });
}

