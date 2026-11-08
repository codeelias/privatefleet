/**
 * P1 slice 6 (docs/56 sections 11-12): deterministic synthetic 120-second
 * demonstration scenario. The demo tenant is isolated by RLS and clearly
 * labelled; everything here is synthetic - no real customer or driver data.
 * Seeding is deterministic (fixed ids, windows computed relative to now so
 * the scenario is repeatable); reset removes every demo row and file.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbHandle } from "../../db/client.js";

export const DEMO = {
  tenantId: "9d0a1111-1111-4111-8111-111111111111",
  tenantSlug: "demo-120s-synthetic",
  tenantName: "DEMO 120s SYNTHETIC",
  driverAId: "9d0a2222-2222-4222-8222-222222222222",
  driverAName: "Demo Driver A",
  driverBId: "9d0a3333-3333-4333-8333-333333333333",
  driverBName: "Demo Driver B",
  vehicleAId: "9d0a4444-4444-4444-8444-444444444444",
  vehicleBId: "9d0a5555-5555-4555-8555-555555555555",
  pinHash: "", // filled by the caller (argon hash of "1234")
} as const;

export interface DemoIds {
  jobId: string;
  stopPickupId: string;
  stopDropoffId: string;
  routeId: string;
}

export async function resetDemoScenario(handle: DbHandle): Promise<void> {
  const db = handle.db;
  const statements = [
    sql`DELETE FROM outbox WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM location_points WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM route_stops WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM job_stops WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM jobs WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM routes WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM job_events WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM exception_episodes WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM stop_evidence WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM tracking_tokens WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM notifications WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM users WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM drivers WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM vehicles WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM proof_policies WHERE tenant_id = ${DEMO.tenantId}`,
    sql`DELETE FROM tenants WHERE id = ${DEMO.tenantId}`,
  ];
  for (const statement of statements) {
    await db.execute(statement);
  }
}

/**
 * Deterministic scenario: an urgent job whose dropoff window is committed,
 * with a route plan that would breach it, two drivers, a proof policy
 * requiring photo + signature + recipient, and the canonical assignment
 * event for Driver A.
 */
export async function seedDemoScenario(
  handle: DbHandle,
  pinHash: string,
): Promise<DemoIds> {
  await resetDemoScenario(handle);
  const db = handle.db;
  const jobId = randomUUID();
  const stopPickupId = randomUUID();
  const stopDropoffId = randomUUID();
  const routeId = randomUUID();

  await db.execute(sql`
    INSERT INTO tenants (id, name, slug, created_at)
    VALUES (${DEMO.tenantId}, ${DEMO.tenantName}, ${DEMO.tenantSlug}, now())
  `);
  await db.execute(sql`
    INSERT INTO proof_policies (tenant_id, service_type, require_recipient, require_signature, require_photo)
    VALUES (${DEMO.tenantId}, '*', true, true, true)
  `);
  await db.execute(sql`
    INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id, latitude, longitude, captured_at)
    VALUES (${DEMO.vehicleAId}, ${DEMO.tenantId}, 'DEMO-A', 'Van', 'on_route', ${DEMO.driverAId}, 51.5000, -0.1200, now())
  `);
  await db.execute(sql`
    INSERT INTO vehicles (id, tenant_id, registration, vehicle_type, status, driver_id, latitude, longitude, captured_at)
    VALUES (${DEMO.vehicleBId}, ${DEMO.tenantId}, 'DEMO-B', 'Van', 'on_route', ${DEMO.driverBId}, 51.5100, -0.1100, now())
  `);
  await db.execute(sql`
    INSERT INTO drivers (id, tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
    VALUES
      (${DEMO.driverAId}, ${DEMO.tenantId}, ${DEMO.driverAName}, 'on_route', ${pinHash}, ${DEMO.vehicleAId}, now()),
      (${DEMO.driverBId}, ${DEMO.tenantId}, ${DEMO.driverBName}, 'on_route', ${pinHash}, ${DEMO.vehicleBId}, now())
  `);
  await db.execute(sql`
    INSERT INTO jobs (id, tenant_id, reference, service_type, priority, status, assigned_driver_id, assigned_vehicle_id)
    VALUES (${jobId}, ${DEMO.tenantId}, 'DEMO-URGENT-1', 'Delivery', 'urgent', 'unassigned', NULL, NULL)
  `);
  await db.execute(sql`
    INSERT INTO job_stops (id, tenant_id, job_id, sequence, stop_type, address, latitude, longitude, window_start, window_end, status)
    VALUES
      (${stopPickupId}, ${DEMO.tenantId}, ${jobId}, 1, 'pickup', '10 Demo Pickup Row, London', 51.5000, -0.1200,
        now() - interval '20 minutes', now() + interval '40 minutes', 'pending'),
      (${stopDropoffId}, ${DEMO.tenantId}, ${jobId}, 2, 'dropoff', '24 Demo Delivery Way, London', 51.5080, -0.1000,
        now() - interval '5 minutes', now() + interval '15 minutes', 'pending')
  `);
  // The canonical assignment event is created by the REAL assign workflow in
  // phase 3 of the demonstration - not seeded.
  // Route plan: dropoff planned arrival AFTER the window -> planned_breach.
  await db.execute(sql`
    INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version, geometry, published_at)
    VALUES (${routeId}, ${DEMO.tenantId}, current_date, ${DEMO.driverAId}, ${DEMO.vehicleAId}, 'published', 1,
      '[{"latitude":51.5,"longitude":-0.12},{"latitude":51.508,"longitude":-0.1}]'::jsonb, now())
  `);
  await db.execute(sql`
    INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no, planned_arrival_at)
    VALUES
      (${randomUUID()}, ${DEMO.tenantId}, ${routeId}, ${stopPickupId}, 1, now() - interval '2 minutes'),
      (${randomUUID()}, ${DEMO.tenantId}, ${routeId}, ${stopDropoffId}, 2, now() + interval '30 minutes')
  `);
  return { jobId, stopPickupId, stopDropoffId, routeId };
}

/** Tiny deterministic PNG for demo evidence files. */
export const DEMO_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Valid signature path data (M/L commands only, per the evidence grammar). */
export const DEMO_SIGNATURE_PATH = "M10,60 L80,25 L150,55 L190,20";
