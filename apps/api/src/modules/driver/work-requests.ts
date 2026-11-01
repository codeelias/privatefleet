/**
 * Durable driver "request more jobs" intake. The request is a signal to the
 * dispatcher; it does not assign work by itself.
 */
import { sql } from "drizzle-orm";
import { withTenant, type DbHandle } from "../../db/client.js";

export class WorkRequestError extends Error {
  constructor(
    readonly code:
      | "WORK_REQUEST_EXISTS"
      | "WORK_REQUEST_NOT_FOUND"
      | "WORK_REQUEST_CONFLICT"
      | "DRIVER_NOT_ELIGIBLE",
  ) {
    super(code);
  }
}

export interface WorkRequestDto {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  registration: string | null;
  status: string;
  requestedAt: string;
  routeVersion: number | null;
  policyRevision: number | null;
  note: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  lastGpsAt: string | null;
  gpsAgeSeconds: number | null;
}

interface Row {
  id: string;
  driver_id: string;
  full_name: string;
  vehicle_id: string | null;
  registration: string | null;
  status: string;
  requested_at: Date | string;
  route_version: number | null;
  policy_revision: number | null;
  note: string | null;
  decided_at: Date | string | null;
  decision_note: string | null;
  captured_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDto(row: Row): WorkRequestDto {
  const lastGps = iso(row.captured_at);
  return {
    id: row.id,
    driverId: row.driver_id,
    driverName: row.full_name,
    vehicleId: row.vehicle_id,
    registration: row.registration,
    status: row.status,
    requestedAt: iso(row.requested_at)!,
    routeVersion: row.route_version,
    policyRevision: row.policy_revision,
    note: row.note,
    decidedAt: iso(row.decided_at),
    decisionNote: row.decision_note,
    lastGpsAt: lastGps,
    gpsAgeSeconds: lastGps
      ? Math.max(0, Math.round((Date.now() - new Date(lastGps).getTime()) / 1000))
      : null,
  };
}

const SELECT = sql`
  SELECT r.id, r.driver_id, d.full_name, r.vehicle_id, v.registration,
         r.status, r.requested_at, r.route_version, r.policy_revision,
         r.note, r.decided_at, r.decision_note, v.captured_at
  FROM driver_work_requests r
  JOIN drivers d ON d.id = r.driver_id
  LEFT JOIN vehicles v ON v.id = r.vehicle_id
`;

export async function createWorkRequest(
  handle: DbHandle,
  tenantId: string,
  driverId: string,
  note?: string,
): Promise<WorkRequestDto> {
  return withTenant(handle, tenantId, async (db) => {
    const drivers = (await db.execute(sql`
      SELECT id, status, vehicle_id FROM drivers WHERE id = ${driverId}
    `)) as unknown as Array<{
      id: string;
      status: string;
      vehicle_id: string | null;
    }>;
    const driver = drivers[0];
    if (!driver || (driver.status !== "on_route" && driver.status !== "available")) {
      throw new WorkRequestError("DRIVER_NOT_ELIGIBLE");
    }
    const pending = (await db.execute(sql`
      SELECT id FROM driver_work_requests
      WHERE tenant_id = ${tenantId} AND driver_id = ${driverId} AND status = 'pending'
    `)) as unknown as Array<{ id: string }>;
    if (pending[0]) throw new WorkRequestError("WORK_REQUEST_EXISTS");

    const versionRows = (await db.execute(sql`
      SELECT coalesce(max(version), 0) AS version FROM routes
      WHERE tenant_id = ${tenantId} AND status IN ('published', 'in_progress')
    `)) as unknown as Array<{ version: number }>;
    const policyRows = (await db.execute(sql`
      SELECT revision FROM dispatch_policies WHERE tenant_id = ${tenantId}
    `)) as unknown as Array<{ revision: number }>;

    const inserted = (await db.execute(sql`
      INSERT INTO driver_work_requests
        (tenant_id, driver_id, vehicle_id, route_version, policy_revision, note)
      VALUES
        (${tenantId}, ${driverId}, ${driver.vehicle_id},
         ${Number(versionRows[0]?.version ?? 0)},
         ${Number(policyRows[0]?.revision ?? 0)}, ${note ?? null})
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const id = inserted[0]?.id;
    if (!id) throw new WorkRequestError("WORK_REQUEST_CONFLICT");

    await db.execute(sql`
      INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${tenantId}, 'driver', ${driverId}, 'driver.work_requested',
        ${JSON.stringify({ requestId: id, driverId })}::jsonb)
    `);
    const rows = (await db.execute(sql`${SELECT} WHERE r.id = ${id}`)) as unknown as Row[];
    return toDto(rows[0]!);
  });
}

export async function getDriverWorkRequest(
  handle: DbHandle,
  tenantId: string,
  driverId: string,
): Promise<WorkRequestDto | null> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      ${SELECT}
      WHERE r.tenant_id = ${tenantId} AND r.driver_id = ${driverId}
      ORDER BY r.requested_at DESC LIMIT 1
    `)) as unknown as Row[];
    return rows[0] ? toDto(rows[0]) : null;
  });
}

export async function listWorkRequests(
  handle: DbHandle,
  tenantId: string,
): Promise<WorkRequestDto[]> {
  return withTenant(handle, tenantId, async (db) => {
    const rows = (await db.execute(sql`
      ${SELECT}
      WHERE r.tenant_id = ${tenantId}
      ORDER BY (r.status = 'pending') DESC, r.requested_at DESC
      LIMIT 50
    `)) as unknown as Row[];
    return rows.map(toDto);
  });
}

export async function decideWorkRequest(
  handle: DbHandle,
  tenantId: string,
  requestId: string,
  actorId: string,
  decision: "approved" | "declined",
  note?: string,
): Promise<WorkRequestDto> {
  return withTenant(handle, tenantId, async (db) => {
    const updated = (await db.execute(sql`
      UPDATE driver_work_requests
      SET status = ${decision}, decided_at = now(), decided_by = ${actorId},
          decision_note = ${note ?? null}
      WHERE tenant_id = ${tenantId} AND id = ${requestId} AND status = 'pending'
      RETURNING id, driver_id
    `)) as unknown as Array<{ id: string; driver_id: string }>;
    if (!updated[0]) throw new WorkRequestError("WORK_REQUEST_CONFLICT");
    await db.execute(sql`
      INSERT INTO outbox (tenant_id, aggregate_type, aggregate_id, event_type, payload)
      VALUES (${tenantId}, 'driver', ${updated[0].driver_id}, 'driver.work_request_decided',
        ${JSON.stringify({ requestId, decision, note: note ?? null })}::jsonb)
    `);
    const rows = (await db.execute(sql`${SELECT} WHERE r.id = ${requestId}`)) as unknown as Row[];
    return toDto(rows[0]!);
  });
}
