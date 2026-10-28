/**
 * Auth E2E server: seeds a deterministic tenant, then serves the real
 * API in postgres mode with a short access-token TTL so the browser
 * acceptance tests can exercise refresh-on-expiry.
 */
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
  const seeded = await seedTenant(migrator, {
    tenantName: "Northstar Couriers",
    email: "owner@northstar.demo",
    password: "demo-password-123",
    slug: SLUG,
  });
  console.log(`auth-e2e tenant seeded: ${seeded.tenantSlug} (${seeded.jobs} jobs)`);
} finally {
  await closeDb(migrator);
}

const config = loadConfig({ ...process.env, REPOSITORY_MODE: "postgres" });
const { app } = buildApp(config);
try {
  await app.listen({ port: config.port, host: "127.0.0.1" });
  app.log.info({ port: config.port, slug: SLUG }, "auth-e2e api ready");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
