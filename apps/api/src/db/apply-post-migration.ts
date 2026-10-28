/**
 * Applies post-migration SQL (PostGIS columns, indexes, RLS) after the
 * drizzle migrations. Idempotent, so it is safe to re-run.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const sqlFile = join(here, "post-migration.sql");

const url =
  process.env.MIGRATION_DATABASE_URL ??
  "postgres://privatefleet:privatefleet_dev_pw@127.0.0.1:5432/privatefleet_dev";

const sql = postgres(url, { max: 1, onnotice: () => undefined });
try {
  const script = readFileSync(sqlFile, "utf8");
  await sql.unsafe(script);
  console.log("post-migration applied: PostGIS columns/indexes + RLS policies");
} finally {
  await sql.end({ timeout: 5 });
}
