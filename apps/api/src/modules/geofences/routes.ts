/**
 * Geofence administration and evaluation surfaces (Stage 4, commit 3).
 * Evaluation itself runs inside telemetry ingestion; these routes only create
 * and list tenant geofences for the operator and tests.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import { withTenant, type DbHandle } from "../../db/client.js";

const GeofenceBodySchema = z.object({
  name: z.string().min(1).max(120),
  geojson: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  jobId: z.string().uuid().optional(),
  /** Empty/omitted = every vehicle; otherwise evaluation is scoped to these drivers. */
  driverIds: z.array(z.string().uuid()).max(100).optional(),
});

export function registerGeofenceRoutes(
  app: FastifyInstance,
  auth: AuthService,
  handle: DbHandle,
): void {
  const guard = makeAuthGuard(auth);

  app.post("/v1/geofences", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/geofence_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "GEOFENCE_STAFF_ONLY",
        detail: "Geofence configuration requires a staff account",
        uiMessage: "Ask dispatch to configure geofences.",
      });
    }
    const body = GeofenceBodySchema.parse(request.body);
    const tenantId = request.auth?.tenantId ?? "";
    return withTenant(handle, tenantId, async (db) => {
      if (body.jobId) {
        const linked = (await db.execute(sql`
          SELECT 1 FROM jobs WHERE id = ${body.jobId}
        `)) as unknown as Array<unknown>;
        if (linked.length === 0) {
          return reply.status(404).send({
            type: "https://privatefleet.example/errors/job_not_found",
            title: "Request could not be completed",
            status: 404,
            code: "JOB_NOT_FOUND",
            detail: "That job does not exist in this workspace",
            uiMessage: "That job no longer exists.",
          });
        }
      }
      const driverIds = body.driverIds ?? [];
      if (driverIds.length > 0) {
        const drivers = (await db.execute(sql`
          SELECT count(*)::int AS count FROM drivers
          WHERE id IN (${sql.join(driverIds, sql`, `)})
        `)) as unknown as Array<{ count: number }>;
        if ((drivers[0]?.count ?? 0) !== driverIds.length) {
          return reply.status(404).send({
            type: "https://privatefleet.example/errors/driver_not_found",
            title: "Request could not be completed",
            status: 404,
            code: "DRIVER_NOT_FOUND",
            detail: "One of the scoped drivers does not exist in this workspace",
            uiMessage: "Refresh the driver list and try again.",
          });
        }
      }
      const rows = (await db.execute(sql`
        INSERT INTO geofences (id, tenant_id, name, geojson, enabled, job_id, driver_ids)
        VALUES (${randomUUID()}, ${tenantId}, ${body.name}, ${body.geojson}, ${body.enabled}, ${body.jobId ?? null}, ${JSON.stringify(driverIds)}::jsonb)
        RETURNING id, name, geojson, enabled, job_id, driver_ids, created_at
      `)) as unknown as Array<{
        id: string;
        name: string;
        geojson: string;
        enabled: boolean;
        job_id: string | null;
        driver_ids: string[] | null;
        created_at: Date | string;
      }>;
      const row = rows[0]!;
      return {
        id: row.id,
        name: row.name,
        geojson: row.geojson,
        enabled: row.enabled,
        ...(row.job_id ? { jobId: row.job_id } : {}),
        driverIds: row.driver_ids ?? [],
        createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
      };
    });
  });

  const PatchBodySchema = z.object({
    name: z.string().min(1).max(120).optional(),
    geojson: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    driverIds: z.array(z.string().uuid()).max(100).optional(),
  });

  app.get("/v1/geofences", { preHandler: guard }, async (request) => {
    return withTenant(handle, request.auth?.tenantId ?? "", async (db) => {
      const rows = (await db.execute(sql`
        SELECT id, name, geojson, enabled, job_id, driver_ids, created_at
        FROM geofences WHERE tenant_id = ${request.auth?.tenantId ?? ""}
        ORDER BY created_at DESC
      `)) as unknown as Array<{
        id: string;
        name: string;
        geojson: string;
        enabled: boolean;
        job_id: string | null;
        driver_ids: string[] | null;
        created_at: Date | string;
      }>;
      return {
        geofences: rows.map((row) => ({
          id: row.id,
          name: row.name,
          geojson: row.geojson,
          enabled: row.enabled,
          ...(row.job_id ? { jobId: row.job_id } : {}),
          driverIds: row.driver_ids ?? [],
          createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
        })),
      };
    });
  });

  app.patch("/v1/geofences/:id", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/geofence_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "GEOFENCE_STAFF_ONLY",
        detail: "Geofence configuration requires a staff account",
        uiMessage: "Ask dispatch to configure geofences.",
      });
    }
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = PatchBodySchema.parse(request.body ?? {});
    const tenantId = request.auth?.tenantId ?? "";
    return withTenant(handle, tenantId, async (db) => {
      if (body.driverIds) {
        const drivers = (await db.execute(sql`
          SELECT count(*)::int AS count FROM drivers
          WHERE id IN (${sql.join(body.driverIds, sql`, `)})
        `)) as unknown as Array<{ count: number }>;
        if ((drivers[0]?.count ?? 0) !== body.driverIds.length) {
          return reply.status(404).send({
            type: "https://privatefleet.example/errors/driver_not_found",
            title: "Request could not be completed",
            status: 404,
            code: "DRIVER_NOT_FOUND",
            detail: "One of the scoped drivers does not exist in this workspace",
            uiMessage: "Refresh the driver list and try again.",
          });
        }
      }
      const rows = (await db.execute(sql`
        UPDATE geofences SET
          name = COALESCE(${body.name ?? null}, name),
          geojson = COALESCE(${body.geojson ?? null}, geojson),
          enabled = COALESCE(${body.enabled ?? null}, enabled),
          driver_ids = COALESCE(${body.driverIds ? JSON.stringify(body.driverIds) : null}::jsonb, driver_ids)
        WHERE id = ${params.id}
        RETURNING id, name, geojson, enabled, job_id, driver_ids, created_at
      `)) as unknown as Array<{
        id: string;
        name: string;
        geojson: string;
        enabled: boolean;
        job_id: string | null;
        driver_ids: string[] | null;
        created_at: Date | string;
      }>;
      const row = rows[0];
      if (!row) {
        return reply.status(404).send({
          type: "https://privatefleet.example/errors/geofence_not_found",
          title: "Request could not be completed",
          status: 404,
          code: "GEOFENCE_NOT_FOUND",
          detail: "That geofence does not exist",
          uiMessage: "That geofence no longer exists.",
        });
      }
      return {
        id: row.id,
        name: row.name,
        geojson: row.geojson,
        enabled: row.enabled,
        ...(row.job_id ? { jobId: row.job_id } : {}),
        driverIds: row.driver_ids ?? [],
        createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
      };
    });
  });

  app.delete("/v1/geofences/:id", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/geofence_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "GEOFENCE_STAFF_ONLY",
        detail: "Geofence configuration requires a staff account",
        uiMessage: "Ask dispatch to configure geofences.",
      });
    }
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return withTenant(handle, request.auth?.tenantId ?? "", async (db) => {
      const rows = (await db.execute(sql`
        DELETE FROM geofences WHERE id = ${params.id} RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (rows.length === 0) {
        return reply.status(404).send({
          type: "https://privatefleet.example/errors/geofence_not_found",
          title: "Request could not be completed",
          status: 404,
          code: "GEOFENCE_NOT_FOUND",
          detail: "That geofence does not exist",
          uiMessage: "That geofence no longer exists.",
        });
      }
      return { deleted: true };
    });
  });
}

