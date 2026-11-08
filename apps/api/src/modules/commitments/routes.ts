/**
 * Response-action routes (docs/56 section 8): dispatcher-only recording of
 * typed, append-only response actions against an exception episode.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { DbHandle } from "../../db/client.js";
import { recordResponseAction, responseEvents, RESPONSE_ACTION_TYPES } from "./response-actions.js";

const ParamsSchema = z.object({
  jobId: z.string().uuid(),
  episodeId: z.string().uuid(),
});
const JobParamsSchema = z.object({ jobId: z.string().uuid() });

const ResponseBodySchema = z.object({
  episodeId: z.string().uuid(),
  actionType: z.enum(RESPONSE_ACTION_TYPES),
  stage: z.enum(["attempt", "confirmed"]),
  idempotencyKey: z.string().min(8).max(128),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export function registerCommitmentRoutes(
  app: FastifyInstance,
  auth: AuthService,
  handle: DbHandle,
): void {
  const guard = makeAuthGuard(auth);

  app.post("/v1/fleet/jobs/:jobId/response", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/response_dispatcher_only",
        title: "Dispatcher action",
        status: 403,
        code: "RESPONSE_DISPATCHER_ONLY",
        detail: "Recording a response action requires a dispatcher account",
        uiMessage: "Ask dispatch to record the response.",
      });
    }
    const params = JobParamsSchema.parse(request.params);
    const body = ResponseBodySchema.parse(request.body);
    const tenantId = request.auth?.tenantId ?? "";
    const result = await recordResponseAction(
      handle,
      tenantId,
      params.jobId,
      request.auth?.userId ?? "",
      {
        episodeId: body.episodeId,
        actionType: body.actionType,
        stage: body.stage,
        idempotencyKey: body.idempotencyKey,
        payload: body.payload,
      },
    );
    if (result.duplicate) {
      return reply.status(409).send({
        type: "https://privatefleet.example/errors/response_duplicate",
        title: "Action already recorded",
        status: 409,
        code: "RESPONSE_DUPLICATE",
        detail: "This idempotency key was already used for a response action",
        uiMessage: "That action is already recorded. Nothing was written twice.",
      });
    }
    return { eventId: result.eventId, recorded: true };
  });

  app.get(
    "/v1/fleet/jobs/:jobId/episodes/:episodeId/responses",
    { preHandler: guard },
    async (request) => {
      const params = ParamsSchema.parse(request.params);
      return {
        responses: await responseEvents(
          handle,
          request.auth?.tenantId ?? "",
          params.episodeId,
        ),
      };
    },
  );
}
