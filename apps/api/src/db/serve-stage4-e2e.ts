/**
 * Stage 4 E2E server: seeds the deterministic auth tenant plus a published
 * route so the Delivery Performance report, geofence and public-tracking
 * workflows run over real HTTP/database paths.
 */
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { closeDb, createDb } from "./client.js";
import { ensureDatabase } from "./ensure-db.js";
import { seedTenant } from "./seed.js";

const APP_URL = process.env.DATABASE_URL ?? "";
const MIGRATOR_URL = process.env.MIGRATION_DATABASE_URL ?? "";
const SLUG = process.env.E2E_TENANT_SLUG ?? "northstar-auth-e2e";

if (!APP_URL || !MIGRATOR_URL) {
  console.error("DATABASE_URL and MIGRATION_DATABASE_URL are required");
  process.exit(1);
}

await ensureDatabase(APP_URL);
const migrator = createDb(MIGRATOR_URL, { max: 1 });
try {
  for (const slug of [SLUG]) {
    await migrator.sql`DELETE FROM tenants WHERE slug = ${slug}`;
  }
  const seeded = await seedTenant(migrator, {
    tenantName: "Northstar Couriers",
    email: "owner@northstar.demo",
    password: "demo-password-123",
    slug: SLUG,
  });

  // Publish one route so the delivery performance report has real rows.
  const tenant = (await migrator.sql`
    SELECT id FROM tenants WHERE slug = ${SLUG}
  `) as unknown as Array<{ id: string }>;
  const tenantId = tenant[0]?.id;
  if (tenantId) {
    const vehicle = (await migrator.sql`
      SELECT v.id AS vehicle_id, v.registration, d.id AS driver_id
      FROM vehicles v LEFT JOIN drivers d ON d.vehicle_id = v.id
      WHERE v.tenant_id = ${tenantId} ORDER BY v.created_at LIMIT 1
    `) as unknown as Array<{ vehicle_id: string; registration: string; driver_id: string | null }>;
    const job = (await migrator.sql`
      SELECT id, reference FROM jobs WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1
    `) as unknown as Array<{ id: string; reference: string }>;
    const stops = job.length
      ? ((await migrator.sql`
          SELECT id, sequence FROM job_stops WHERE job_id = ${job[0]!.id} ORDER BY sequence LIMIT 2
        `) as unknown as Array<{ id: string; sequence: number }>)
      : [];
    if (vehicle.length && job.length && stops.length >= 1 && vehicle[0]?.driver_id) {
      const routeId = randomUUID();
      await migrator.sql`
        INSERT INTO routes (id, tenant_id, route_date, driver_id, vehicle_id, status, version,
          planned_distance_m, planned_duration_s, published_at)
        VALUES (${routeId}, ${tenantId}, current_date, ${vehicle[0]!.driver_id},
          ${vehicle[0]!.vehicle_id}, 'published', 1, 5400, 1800, now())
      `;
      for (const stop of stops) {
        await migrator.sql`
          INSERT INTO route_stops (id, tenant_id, route_id, job_stop_id, sequence_no,
            planned_arrival_at, planned_departure_at, status)
          VALUES (${randomUUID()}, ${tenantId}, ${routeId}, ${stop.id}, ${stop.sequence},
            now() + interval '10 minutes' * ${stop.sequence}, now() + interval '10 minutes' * ${stop.sequence} + interval '5 minutes',
            'planned')
        `;
      }
    }
  }
  console.log(`stage4-e2e tenant seeded: ${seeded.tenantSlug} (${seeded.jobs} jobs)`);
} finally {
  await closeDb(migrator);
}

const config = loadConfig({ ...process.env, REPOSITORY_MODE: "postgres" });
const { app } = buildApp(config);
try {
  await app.listen({ port: config.port, host: "127.0.0.1" });
  app.log.info({ port: config.port, slug: SLUG }, "stage4-e2e api ready");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
