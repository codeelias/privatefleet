/**
 * Phase 2 fleet routes: same URLs and response shapes as the demo
 * surface, now authenticated, tenant-scoped and idempotent. Every
 * command writes job_events + outbox in the same transaction and
 * publishes after commit.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AssignRequestSchema } from "@privatefleet/contracts";
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
const SkipBodySchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().min(1),
});
const AlertParamSchema = z.object({ alertId: z.string().uuid() });

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

export function registerFleetRoutes(
  app: FastifyInstance,
  auth: AuthService,
  fleet: PgFleetService,
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
        body.reason,
        idempotencyKey(request),
      );
      await fleet.publishPending(tenantId);
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
}




