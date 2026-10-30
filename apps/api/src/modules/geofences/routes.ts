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
      const rows = (await db.execute(sql`
        INSERT INTO geofences (id, tenant_id, name, geojson, enabled)
        VALUES (${randomUUID()}, ${tenantId}, ${body.name}, ${body.geojson}, ${body.enabled})
        RETURNING id, name, geojson, enabled, created_at
      `)) as unknown as Array<{
        id: string;
        name: string;
        geojson: string;
        enabled: boolean;
        created_at: Date | string;
      }>;
      const row = rows[0]!;
      return {
        id: row.id,
        name: row.name,
        geojson: row.geojson,
        enabled: row.enabled,
        createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
      };
    });
  });

  app.get("/v1/geofences", { preHandler: guard }, async (request) => {
    return withTenant(handle, request.auth?.tenantId ?? "", async (db) => {
      const rows = (await db.execute(sql`
        SELECT id, name, geojson, enabled, created_at
        FROM geofences WHERE tenant_id = ${request.auth?.tenantId ?? ""}
        ORDER BY created_at DESC
      `)) as unknown as Array<{
        id: string;
        name: string;
        geojson: string;
        enabled: boolean;
        created_at: Date | string;
      }>;
      return {
        geofences: rows.map((row) => ({
          id: row.id,
          name: row.name,
          geojson: row.geojson,
          enabled: row.enabled,
          createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
        })),
      };
    });
  });
}
