/**
 * Migration runner: applies drizzle SQL migrations, then the idempotent
 * post-migration SQL (PostGIS columns/indexes + RLS). Runs as the
 * migrator role (owner) - never as the runtime app role.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrationDatabaseUrl } from "../config.js";
import { ensureDatabase } from "./ensure-db.js";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "..", "..", "drizzle");
const postMigrationFile = join(here, "post-migration.sql");
const url = migrationDatabaseUrl();

await ensureDatabase(url);
const sql = postgres(url, { max: 1, onnotice: () => undefined });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder });
  console.log("drizzle migrations: up to date");
  const postMigration = readFileSync(postMigrationFile, "utf8");
  await sql.unsafe(postMigration);
  console.log("post-migration: PostGIS columns/indexes + RLS applied");
} catch (err) {
  console.error("migration failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
