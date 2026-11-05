/**
 * Phase 2 fleet routes: same URLs and response shapes as the demo
 * surface, now authenticated, tenant-scoped and idempotent. Every
 * command writes job_events + outbox in the same transaction and
 * publishes after commit.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  AssignRequestSchema,
  FailureReasonCodeSchema,
  JobImportCommitRequestSchema,
} from "@privatefleet/contracts";
import type { ImportServiceArea } from "../import/csv.js";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { PgFleetService } from "./pg-service.js";

type Params = Record<string, string | undefined>;

const JobParamSchema = z.object({ jobId: z.string().uuid() });
const DriverBodySchema = z.object({ driverId: z.string().uuid() });
const StopParamSchema = z.object({
  jobId: z.string().uuid(),
  stopId: z.string().uuid(),
});
const CompleteBodySchema = z.object({
  driverId: z.string().uuid(),
  recipientName: z.string().optional(),
  notes: z.string().optional(),
});
const SkipBodySchema = z
  .object({
    driverId: z.string().uuid(),
    reasonCode: FailureReasonCodeSchema.optional(),
    reason: z.string().max(1000).optional(),
    note: z.string().max(1000).optional(),
  })
  .refine((value) => Boolean(value.reasonCode || value.reason), {
    message: "A structured failure reason is required",
  });
const AlertParamSchema = z.object({ alertId: z.string().uuid() });
const ImportPreviewBodySchema = z.union([
  z.object({ csv: z.string().min(1).max(2_100_000) }),
  z.string().min(1).max(2_100_000),
]);

/** Driver tokens may only act as themselves; staff tokens may delegate. */
function activeDriverId(
  request: { auth?: { role: string; userId: string } },
  bodyDriverId: string,
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
): string | null {
  if (request.auth?.role === "driver") {
    if (bodyDriverId !== request.auth.userId) {
      void reply.status(403).send({
        type: "https://privatefleet.example/errors/stop_not_assigned_to_driver",
        title: "Request could not be completed",
        status: 403,
        code: "STOP_NOT_ASSIGNED_TO_DRIVER",
        detail: "Driver tokens cannot act for another driver",
        uiMessage: "This stop is not assigned to you. Pull to refresh your queue.",
      });
      return null;
    }
    return request.auth.userId;
  }
  return bodyDriverId;
}

function idempotencyKey(request: { headers: Record<string, unknown> }): string | undefined {
  const raw = request.headers["idempotency-key"];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** Hash of the raw request body for the idempotency reuse contract (docs/54 R1). */
function requestHash(request: { body: unknown }): string {
  return createHash("sha256")
    .update(JSON.stringify(request.body ?? null))
    .digest("hex");
}

export function registerFleetRoutes(
  app: FastifyInstance,
  auth: AuthService,
  fleet: PgFleetService,
  importArea: ImportServiceArea,
): void {
  const guard = makeAuthGuard(auth);

  app.get("/v1/fleet/state", { preHandler: guard }, async (request) => {
    const query = (request.query ?? {}) as { includeRoutes?: string };
    return fleet.snapshot(request.auth?.tenantId ?? "", {
      includeRoutes: query.includeRoutes !== "false",
    });
  });

  app.get("/v1/fleet/routes", { preHandler: guard }, async (request) => {
    return fleet.routes(request.auth?.tenantId ?? "");
  });

  app.post(
    "/v1/jobs/:jobId/assignment-preview",
    { preHandler: guard },
    async (request) => {
      const params = JobParamSchema.parse({ jobId: (request.params as Params).jobId });
      const body = DriverBodySchema.parse(request.body);
      return fleet.previewAssignment(request.auth?.tenantId ?? "", params.jobId, body.driverId);
    },
  );

  app.post("/v1/jobs/:jobId/assign", { preHandler: guard }, async (request) => {
    const params = JobParamSchema.parse({ jobId: (request.params as Params).jobId });
    const body = AssignRequestSchema.parse({
      ...(request.body as Record<string, unknown>),
      jobId: params.jobId,
    });
    const tenantId = request.auth?.tenantId ?? "";
    const result = await fleet.assign(
      tenantId,
      request.auth?.userId ?? "",
      params.jobId,
      body.driverId,
      idempotencyKey(request) ?? `assign-${params.jobId}`,
      requestHash(request),
    );
    await fleet.publishPending(tenantId);
    return result;
  });

  app.post(
    "/v1/jobs/:jobId/stops/:stopId/arrive",
    { preHandler: guard },
    async (request, reply) => {
      const params = StopParamSchema.parse(request.params as Params);
      const body = DriverBodySchema.parse(request.body);
      const tenantId = request.auth?.tenantId ?? "";
      const driverId = activeDriverId(request, body.driverId, reply);
      if (!driverId) {
        return reply;
      }
      const result = await fleet.arrive(
        tenantId,
        request.auth?.userId ?? "",
        params.jobId,
        params.stopId,
        driverId,
        idempotencyKey(request),
        requestHash(request),
      );
      await fleet.publishPending(tenantId);
      return result;
    },
  );

  app.post(
    "/v1/jobs/:jobId/stops/:stopId/complete",
    { preHandler: guard },
    async (request, reply) => {
      const params = StopParamSchema.parse(request.params as Params);
      const body = CompleteBodySchema.parse(request.body);
      const tenantId = request.auth?.tenantId ?? "";
      const driverId = activeDriverId(request, body.driverId, reply);
      if (!driverId) {
        return reply;
      }
      const result = await fleet.complete(
        tenantId,
        request.auth?.userId ?? "",
        params.jobId,
        params.stopId,
        driverId,
        { recipientName: body.recipientName, notes: body.notes },
        idempotencyKey(request),
        requestHash(request),
      );
      await fleet.publishPending(tenantId);
      return result;
    },
  );

  app.post(
    "/v1/jobs/:jobId/stops/:stopId/skip",
    { preHandler: guard },
    async (request, reply) => {
      const params = StopParamSchema.parse(request.params as Params);
      const body = SkipBodySchema.parse(request.body);
      const tenantId = request.auth?.tenantId ?? "";
      const driverId = activeDriverId(request, body.driverId, reply);
      if (!driverId) {
        return reply;
      }
      const result = await fleet.skip(
        tenantId,
        request.auth?.userId ?? "",
        params.jobId,
        params.stopId,
        driverId,
        {
          reasonCode: body.reasonCode ?? "OTHER",
          note: body.note ?? body.reason,
        },
        idempotencyKey(request),
        requestHash(request),
      );
      await fleet.publishPending(tenantId);
      return result;
    },
  );

  app.post(
    "/v1/jobs/import",
    { preHandler: guard, bodyLimit: 2_200_000 },
    async (request, reply) => {
      if (request.auth?.role === "driver") {
        return reply.status(403).send({
          type: "https://privatefleet.example/errors/import_staff_only",
          title: "Request could not be completed",
          status: 403,
          code: "IMPORT_STAFF_ONLY",
          detail: "Staff role required",
          uiMessage: "Ask dispatch to import this batch.",
        });
      }
      const body = ImportPreviewBodySchema.parse(request.body);
      const csv = typeof body === "string" ? body : body.csv;
      return fleet.importPreview(request.auth?.tenantId ?? "", csv, importArea);
    },
  );

  app.post(
    "/v1/jobs/import/commit",
    { preHandler: guard, bodyLimit: 2_200_000 },
    async (request, reply) => {
      if (request.auth?.role === "driver") {
        return reply.status(403).send({
          type: "https://privatefleet.example/errors/import_staff_only",
          title: "Request could not be completed",
          status: 403,
          code: "IMPORT_STAFF_ONLY",
          detail: "Staff role required",
          uiMessage: "Ask dispatch to import this batch.",
        });
      }
      const body = JobImportCommitRequestSchema.parse(request.body);
      const result = await fleet.importCommit(
        request.auth?.tenantId ?? "",
        request.auth?.userId ?? "",
        body.jobs,
        importArea,
        idempotencyKey(request),
      );
      await fleet.publishPending(request.auth?.tenantId ?? "");
      return result;
    },
  );

  app.post("/v1/alerts/:alertId/acknowledge", { preHandler: guard }, async (request) => {
    const params = AlertParamSchema.parse({ alertId: (request.params as Params).alertId });
    const tenantId = request.auth?.tenantId ?? "";
    const result = await fleet.actOnAlert(
      tenantId,
      params.alertId,
      request.auth?.userId ?? "",
      "acknowledge",
      idempotencyKey(request),
    );
    await fleet.publishPending(tenantId);
    return result;
  });

  app.post("/v1/alerts/:alertId/resolve", { preHandler: guard }, async (request) => {
    const params = AlertParamSchema.parse({ alertId: (request.params as Params).alertId });
    const tenantId = request.auth?.tenantId ?? "";
    const result = await fleet.actOnAlert(
      tenantId,
      params.alertId,
      request.auth?.userId ?? "",
      "resolve",
      idempotencyKey(request),
    );
    await fleet.publishPending(tenantId);
    return result;
  });

  // Append-only per-entity timeline (docs/54 R2): every job_events row in
  // order - dispute resolution and audit evidence.
  app.get("/v1/jobs/:jobId/timeline", { preHandler: guard }, async (request) => {
    const params = JobParamSchema.parse({ jobId: (request.params as Params).jobId });
    const tenantId = request.auth?.tenantId ?? "";
    return fleet.jobTimeline(tenantId, params.jobId);
  });
}









