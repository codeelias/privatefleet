/**
 * Delivery performance report (Stage 4, commit 1): planned vs recorded
 * arrival and on-time classification over the existing published route and
 * stop tables. Missing timestamps or windows are reported as unavailable,
 * never assumed on-time. Whole-route planned distance is carried as context
 * only; it is never compared with stop-level GPS distance.
 */
import { sql } from "drizzle-orm";
import type { DeliveryPerformanceReport, DeliveryPerformanceRow } from "@privatefleet/contracts";
import { withTenant, type DbHandle } from "../../db/client.js";

interface RowData {
  route_id: string;
  route_date: Date | string;
  version: number;
  planned_distance_m: number | string | null;
  planned_duration_s: number | string | null;
  sequence_no: number;
  planned_arrival_at: Date | string | null;
  stop_id: string;
  status: string;
  address: string;
  arrived_at: Date | string | null;
  completed_at: Date | string | null;
  failure_code: string | null;
  window_start: Date | string | null;
  window_end: Date | string | null;
  job_id: string;
  reference: string;
}

function iso(value: Date | string | null): string | undefined {
  if (value === null) return undefined;
  return typeof value === "string" ? value : value.toISOString();
}

function epoch(value: Date | string | null): number | null {
  if (value === null) return null;
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

function classifyOnTime(
  arrived: Date | string | null,
  start: Date | string | null,
  end: Date | string | null,
): { onTime: DeliveryPerformanceRow["onTime"]; arrivalDeltaS?: number } | { onTime: "unavailable" } {
  const arrivedMs = epoch(arrived);
  const startMs = epoch(start);
  const endMs = epoch(end);
  if (arrivedMs === null || startMs === null || endMs === null) {
    return { onTime: "unavailable" };
  }
  const deltaS = Math.round((arrivedMs - startMs) / 1000);
  if (arrivedMs >= startMs && arrivedMs <= endMs) {
    return { onTime: "on_time", arrivalDeltaS: deltaS };
  }
  return arrivedMs < startMs
    ? { onTime: "early", arrivalDeltaS: deltaS }
    : { onTime: "late", arrivalDeltaS: deltaS };
}

export interface DeliveryPerformanceOptions {
  from?: string | undefined;
  to?: string | undefined;
  jobId?: string | undefined;
}

export async function deliveryPerformance(
  handle: DbHandle,
  tenantId: string,
  options: DeliveryPerformanceOptions,
): Promise<DeliveryPerformanceReport> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      SELECT r.id AS route_id, r.route_date, r.version, r.planned_distance_m, r.planned_duration_s,
             rs.sequence_no, rs.planned_arrival_at,
             s.id AS stop_id, s.status, s.address, s.arrived_at, s.completed_at,
             s.failure_code, s.window_start, s.window_end,
             j.id AS job_id, j.reference
      FROM route_stops rs
      JOIN routes r ON r.id = rs.route_id
      JOIN job_stops s ON s.id = rs.job_stop_id
      JOIN jobs j ON j.id = s.job_id
      WHERE rs.tenant_id = ${tenantId}
        ${options.from ? sql`AND r.route_date >= ${options.from}::date` : sql``}
        ${options.to ? sql`AND r.route_date <= ${options.to}::date` : sql``}
        ${options.jobId ? sql`AND j.id = ${options.jobId}` : sql``}
      ORDER BY r.route_date DESC, rs.sequence_no ASC
    `)) as unknown as RowData[];

    return {
      generatedAt: new Date().toISOString(),
      rows: rows.map((row) => {
        const classification = classifyOnTime(row.arrived_at, row.window_start, row.window_end);
        const planned = epoch(row.planned_arrival_at);
        const arrived = epoch(row.arrived_at);
        const arrivalDeltaS =
          planned !== null && arrived !== null ? Math.round((arrived - planned) / 1000) : undefined;
        return {
          routeId: row.route_id,
          routeDate: typeof row.route_date === "string" ? row.route_date : row.route_date.toISOString().slice(0, 10),
          routeVersion: Number(row.version),
          jobId: row.job_id,
          jobReference: row.reference,
          stopId: row.stop_id,
          stopSequence: Number(row.sequence_no),
          address: row.address,
          stopStatus: row.status,
          ...(row.failure_code ? { failureCode: row.failure_code } : {}),
          ...(iso(row.planned_arrival_at) ? { plannedArrivalAt: iso(row.planned_arrival_at) } : {}),
          ...(iso(row.arrived_at) ? { arrivedAt: iso(row.arrived_at) } : {}),
          ...(iso(row.completed_at) ? { completedAt: iso(row.completed_at) } : {}),
          ...(iso(row.window_start) ? { windowStart: iso(row.window_start) } : {}),
          ...(iso(row.window_end) ? { windowEnd: iso(row.window_end) } : {}),
          windowKnown: row.window_start !== null && row.window_end !== null,
          arrivalKnown: row.arrived_at !== null,
          onTime: classification.onTime,
          ...(arrivalDeltaS !== undefined ? { arrivalDeltaS } : {}),
          ...(row.planned_distance_m !== null && row.planned_distance_m !== undefined
            ? { plannedDistanceM: Number(row.planned_distance_m) }
            : {}),
          ...(row.planned_duration_s !== null && row.planned_duration_s !== undefined
            ? { plannedDurationS: Number(row.planned_duration_s) }
            : {}),
        };
      }),
    };
  });
}

function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function deliveryPerformanceCsv(report: DeliveryPerformanceReport): string {
  const header = [
    "job_reference",
    "address",
    "stop_status",
    "failure_code",
    "planned_arrival_at",
    "arrived_at",
    "completed_at",
    "window_start",
    "window_end",
    "on_time",
    "arrival_delta_s",
    "planned_distance_m",
    "planned_duration_s",
  ];
  const lines = [header.join(",")];
  for (const row of report.rows) {
    lines.push(
      [
        row.jobReference,
        row.address,
        row.stopStatus,
        row.failureCode ?? "",
        row.plannedArrivalAt ?? "",
        row.arrivedAt ?? "",
        row.completedAt ?? "",
        row.windowStart ?? "",
        row.windowEnd ?? "",
        row.onTime === "unavailable" ? "Unavailable" : row.onTime,
        row.arrivalDeltaS ?? "",
        row.plannedDistanceM ?? "",
        row.plannedDurationS ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

