/**
 * Synthetic load smoke (pilot readiness): seed an isolated tenant with
 * vehicles/jobs sharing a bounded set of hubs, then run the real fleet
 * optimisation pipeline through OSRM/VROOM and report stage timings.
 *
 * Usage:
 *   tsx src/db/load-smoke.ts --vehicles=50 --jobs=500
 *   tsx src/db/load-smoke.ts --vehicles=100 --jobs=1000
 *   tsx src/db/load-smoke.ts --vehicles=10 --jobs=200 --hubs=151  (guard)
 */
import { randomUUID } from "node:crypto";
import { createDb, closeDb } from "./client.js";
import { migrationDatabaseUrl } from "../config.js";
import { seedTenant } from "./seed.js";
import { createFleetProposal } from "../modules/optimization/fleet-service.js";
import { OsrmClient } from "../modules/routing/osrm.js";
import { VroomClient } from "../modules/routing/vroom.js";
import type { RoutingClients } from "../modules/routing/types.js";

function arg(name: string, fallback: number): number {
  const found = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
}

const vehicleCount = arg("vehicles", 50);
const jobCount = arg("jobs", 500);
const hubCount = arg("hubs", 120);
const clients: RoutingClients = {
  matrix: (points) => new OsrmClient(process.env.OSRM_BASE_URL ?? "http://127.0.0.1:5000").matrix(points),
  route: (points) => new OsrmClient(process.env.OSRM_BASE_URL ?? "http://127.0.0.1:5000").route(points),
  solve: (vehicles, shipments, matrices, count, jobs) =>
    new VroomClient(
      process.env.VROOM_BASE_URL ?? "http://127.0.0.1:3000",
      fetch,
      180_000,
    ).solve(vehicles, shipments, matrices, count, jobs),
};

const runtime = createDb(
  process.env.DATABASE_URL ??
    "postgres://privatefleet_app:privatefleet_app_pw@127.0.0.1:5432/privatefleet_dev",
  { max: 4 },
);
const migrator = createDb(migrationDatabaseUrl(), { max: 2 });

const hubs = Array.from({ length: hubCount }, (_, index) => ({
  latitude: 51.45 + ((index * 37) % 100) * 0.0012,
  longitude: -0.35 + ((index * 53) % 100) * 0.0015,
  address: `Load Hub ${index + 1}, London`,
}));

const started = Date.now();
const seeded = await seedTenant(migrator, {
  tenantName: "Load Smoke Co",
  email: `load-${randomUUID().slice(0, 6)}@privatefleet.test`,
  password: "demo-password-123",
  slug: `load-${randomUUID().slice(0, 8)}`,
});
let proposeMs = 0;
let metrics: Record<string, unknown> = {};
let result: Awaited<ReturnType<typeof createFleetProposal>> | null = null;
try {
  const extra = Math.max(0, vehicleCount - 3);
  if (extra > 0) {
    await migrator.sql`SELECT 1`;
    await migrator.sql`
      WITH new_vehicles AS (
        INSERT INTO vehicles (tenant_id, registration, vehicle_type, status)
        SELECT ${seeded.tenantId}, 'LOAD-VAN-' || g, 'Van', 'available'
        FROM generate_series(1, ${extra}) AS g
        RETURNING id
      ), numbered AS (
        SELECT id, row_number() OVER () AS rn FROM new_vehicles
      )
      INSERT INTO drivers (tenant_id, full_name, status, pin_hash, vehicle_id, last_ping_at)
      SELECT ${seeded.tenantId}, 'Load Driver ' || rn, 'available',
             (SELECT pin_hash FROM drivers WHERE tenant_id = ${seeded.tenantId} LIMIT 1),
             numbered.id, now()
      FROM numbered
    `;
  }

  // Give every vehicle a unique capability and make most jobs single-stop
  // work requiring that capability. This models driver continuity and keeps
  // the solver from concentrating a whole shift onto one van (the domain has
  // no shift windows yet; see readiness report).
  await migrator.sql`
    WITH numbered AS (
      SELECT id, row_number() OVER (ORDER BY id) AS rn
      FROM vehicles WHERE tenant_id = ${seeded.tenantId}
    )
    UPDATE vehicles v
    SET required_capabilities = ARRAY['load-skill-' || numbered.rn]
    FROM numbered WHERE v.id = numbered.id
  `;

  const pairs = (await migrator.sql`
    SELECT d.id AS driver_id, d.vehicle_id,
           (v.required_capabilities)[1] AS skill
    FROM drivers d
    JOIN vehicles v ON v.id = d.vehicle_id
    WHERE d.tenant_id = ${seeded.tenantId} AND d.vehicle_id IS NOT NULL
    ORDER BY d.id
  `) as unknown as Array<{ driver_id: string; vehicle_id: string; skill: string | null }>;

  const now = Date.now();
  const windowStart = new Date(now + 30 * 60_000).toISOString();
  const windowEnd = new Date(now + 8 * 3_600_000).toISOString();

  await migrator.sql.begin(async (tx) => {
    for (let index = 0; index < jobCount; index += 1) {
      const pair = pairs[index % pairs.length]!;
      const single = index % 10 !== 0;
      const pickup = hubs[index % hubs.length]!;
      const dropoff = hubs[(index * 7 + 3) % hubs.length]!;
      const jobRows = await tx`
        INSERT INTO jobs (tenant_id, reference, service_type, priority, status,
          assigned_driver_id, assigned_vehicle_id, service_seconds, required_capabilities)
        VALUES (${seeded.tenantId}, ${"LOAD-" + index}, 'Delivery', 'standard', 'assigned',
          ${pair.driver_id}, ${pair.vehicle_id}, 120,
          ${single && pair.skill ? [pair.skill] : []}::text[])
        RETURNING id
      `;
      const jobId = (jobRows[0] as unknown as { id: string }).id;
      await tx`
        INSERT INTO job_stops (tenant_id, job_id, sequence, stop_type, address,
          latitude, longitude, window_start, window_end, status)
        VALUES (${seeded.tenantId}, ${jobId}, 1, 'pickup', ${pickup.address},
          ${pickup.latitude}, ${pickup.longitude}, ${windowStart}, ${windowEnd}, 'pending')
      `;
      if (!single) {
        await tx`
          INSERT INTO job_stops (tenant_id, job_id, sequence, stop_type, address,
            latitude, longitude, window_start, window_end, status)
          VALUES (${seeded.tenantId}, ${jobId}, 2, 'dropoff', ${dropoff.address},
            ${dropoff.latitude}, ${dropoff.longitude}, ${windowStart}, ${windowEnd}, 'pending')
        `;
      }
    }
  });

  const proposeStarted = performance.now();
  result = await createFleetProposal(runtime, clients, seeded.tenantId);
  proposeMs = Math.round(performance.now() - proposeStarted);
  const runRows = (await migrator.sql`
    SELECT metrics FROM optimization_runs WHERE id = ${result.runId}
  `) as unknown as Array<{ metrics: Record<string, unknown> }>;
  metrics = runRows[0]?.metrics ?? {};
} finally {
  console.log(
    JSON.stringify(
      {
        mode: "load-smoke",
        vehicles: vehicleCount,
        jobs: jobCount,
        hubs: hubCount,
        proposeMs,
        routes: result?.vehicles.length ?? 0,
        unassigned: result?.unassigned.length ?? 0,
        shipmentCount: result?.shipmentCount ?? 0,
        singleStopJobCount: result?.singleStopJobCount ?? 0,
        matrixSize: result?.matrixSize ?? 0,
        totalDistanceMetres: result?.totalDistanceMetres ?? 0,
        totalDurationSeconds: result?.totalDurationSeconds ?? 0,
        metrics,
        wallMs: Date.now() - started,
      },
      null,
      2,
    ),
  );
  await migrator.sql`DELETE FROM tenants WHERE id = ${seeded.tenantId}`;
  await closeDb(runtime);
  await closeDb(migrator);
}
