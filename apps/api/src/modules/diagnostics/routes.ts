/**
 * Operations diagnostics (staff only, read-only): transactional outbox
 * health. Pending rows older than a threshold indicate a stalled publisher.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AuthService } from "../auth/service";
import { makeAuthGuard } from "../auth/guard";
import { withTenant, type DbHandle } from "../../db/client";

export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  auth: AuthService,
  handle: DbHandle,
): void {
  const guard = makeAuthGuard(auth);

  app.get("/v1/diagnostics/outbox", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/diagnostics_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "DIAGNOSTICS_STAFF_ONLY",
        detail: "Outbox diagnostics require a staff account",
        uiMessage: "Outbox diagnostics are available to dispatchers only.",
      });
    }
    const tenantId = request.auth?.tenantId ?? "";
    const rows = (await withTenant(handle, tenantId, async (db) => {
      return db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE published_at IS NULL)::int AS pending,
          round(extract(epoch from (now() - min(created_at))))::int AS oldest_age_s,
          round(extract(epoch from (now() - max(created_at))))::int AS newest_age_s
        FROM outbox
      `);
    })) as unknown as Array<{
      total: number;
      pending: number;
      oldest_age_s: number | null;
      newest_age_s: number | null;
    }>;
    const row = rows[0] ?? { total: 0, pending: 0, oldest_age_s: null, newest_age_s: null };
    return { outbox: row };
  });
}
