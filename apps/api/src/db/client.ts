/**
 * Database client (docs/04, ADR-0005). Two connection roles:
 * - migrator (owner) runs DDL and seeds;
 * - app (non-owner) is used at runtime so RLS is enforced.
 * Every request runs inside a transaction with `app.tenant_id` set,
 * which the RLS policies read via current_setting().
 */
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  sql: postgres.Sql;
}

export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
  });
  return { db: drizzle(sql, { schema }), sql };
}

/** Run one unit of work scoped to a tenant (RLS context). */
export async function withTenant<T>(
  handle: DbHandle,
  tenantId: string,
  work: (db: Database) => Promise<T>,
): Promise<T> {
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return work(tx as unknown as Database);
  });
}

export async function closeDb(handle: DbHandle): Promise<void> {
  await handle.sql.end({ timeout: 5 });
}
