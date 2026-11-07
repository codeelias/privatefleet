/**
 * Analytics summary (docs/54 R11): read-only aggregates over the published
 * route/stop tables. Percentages and averages are null when there is nothing
 * to measure - nothing is ever assumed.
 */
import { sql } from "drizzle-orm";
import type { AnalyticsReport } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";

interface StopRow {
  status: string;
  arrived_at: Date | string | null;
  window_start: Date | string | null;
  window_end: Date | string | null;
  planned_arrival_at: Date | string | null;
  driver_id: string | null;
  driver_name: string | null;
}

export interface AnalyticsOptions {
  from?: string | undefined;
  to?: string | undefined;
}

/** Pure summarisation, unit-tested separately. */
export function summariseAnalytics(
  rows: StopRow[],
  totalDistanceKm: number,
): Pick<AnalyticsReport, "totals" | "byDriver"> {
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let onTime = 0;
  let early = 0;
  let late = 0;
  let deltaSum = 0;
  let deltaCount = 0;
  const byDriver = new Map<
    string,
    { driverId: string; driverName: string; stopsCompleted: number; onTime: number; early: number; late: number }
  >();

  for (const row of rows) {
    if (row.status === "completed") completed += 1;
    if (row.status === "skipped") skipped += 1;
    if (row.status === "failed") failed += 1;

    const arrived = row.arrived_at
      ? (typeof row.arrived_at === "string" ? Date.parse(row.arrived_at) : row.arrived_at.getTime())
      : null;
    const start = row.window_start
      ? (typeof row.window_start === "string" ? Date.parse(row.window_start) : row.window_start.getTime())
      : null;
    const end = row.window_end
      ? (typeof row.window_end === "string" ? Date.parse(row.window_end) : row.window_end.getTime())
      : null;
    const planned = row.planned_arrival_at
      ? (typeof row.planned_arrival_at === "string" ? Date.parse(row.planned_arrival_at) : row.planned_arrival_at.getTime())
      : null;

    if (row.status === "completed" && arrived !== null && start !== null && end !== null) {
      if (arrived >= start && arrived <= end) onTime += 1;
      else if (arrived < start) early += 1;
      else late += 1;
    }
    if (row.status === "completed" && arrived !== null && planned !== null) {
      deltaSum += (arrived - planned) / 1000;
      deltaCount += 1;
    }
    if (row.driver_id) {
      const entry = byDriver.get(row.driver_id) ?? {
        driverId: row.driver_id,
        driverName: row.driver_name ?? "Driver",
        stopsCompleted: 0,
        onTime: 0,
        early: 0,
        late: 0,
      };
      if (row.status === "completed") entry.stopsCompleted += 1;
      if (row.status === "completed" && arrived !== null && start !== null && end !== null) {
        if (arrived >= start && arrived <= end) entry.onTime += 1;
        else if (arrived < start) entry.early += 1;
        else entry.late += 1;
      }
      byDriver.set(row.driver_id, entry);
    }
  }

  const classifiable = onTime + early + late;
  const pct = (part: number, whole: number): number | null =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

  return {
    totals: {
      stopsCompleted: completed,
      stopsSkipped: skipped,
      stopsFailed: failed,
      onTimePct: pct(onTime, classifiable),
      avgArrivalDeltaS: deltaCount > 0 ? Math.round(deltaSum / deltaCount) : null,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
    },
    byDriver: [...byDriver.values()].map((entry) => ({
      driverId: entry.driverId,
      driverName: entry.driverName,
      stopsCompleted: entry.stopsCompleted,
      onTimePct: pct(entry.onTime, entry.onTime + entry.early + entry.late),
    })),
  };
}

export async function analyticsReport(
  handle: DbHandle,
  tenantId: string,
  options: AnalyticsOptions,
): Promise<AnalyticsReport> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      SELECT s.status, s.arrived_at, s.window_start, s.window_end,
             rs.planned_arrival_at, j.assigned_driver_id AS driver_id, d.full_name AS driver_name
      FROM route_stops rs
      JOIN routes r ON r.id = rs.route_id
      JOIN job_stops s ON s.id = rs.job_stop_id
      JOIN jobs j ON j.id = s.job_id
      LEFT JOIN drivers d ON d.id = j.assigned_driver_id
      WHERE rs.tenant_id = ${tenantId}
        ${options.from ? sql`AND r.route_date >= ${options.from}::date` : sql``}
        ${options.to ? sql`AND r.route_date <= ${options.to}::date` : sql``}
        -- Count each stop once, on its newest plan (docs/53 invariant).
        AND r.version = (
          SELECT max(r3.version)
          FROM route_stops rs3
          JOIN routes r3 ON r3.id = rs3.route_id
          WHERE rs3.job_stop_id = rs.job_stop_id
        )
    `)) as unknown as StopRow[];

    const distanceRows = (await db.execute(sql`
      SELECT COALESCE(SUM(planned_distance_m), 0)::float8 AS total_m
      FROM routes r
      WHERE tenant_id = ${tenantId}
        ${options.from ? sql`AND route_date >= ${options.from}::date` : sql``}
        ${options.to ? sql`AND route_date <= ${options.to}::date` : sql``}
        -- Sum each driver's newest plan once, not every superseded version.
        AND r.version = (
          SELECT max(r2.version) FROM routes r2 WHERE r2.driver_id = r.driver_id
        )
    `)) as unknown as Array<{ total_m: number | string }>;
    const totalDistanceKm = Number(distanceRows[0]?.total_m ?? 0) / 1000;

    return {
      generatedAt: new Date().toISOString(),
      range: { ...(options.from ? { from: options.from } : {}), ...(options.to ? { to: options.to } : {}) },
      ...summariseAnalytics(rows, totalDistanceKm),
    };
  });
}
