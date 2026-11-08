/**
 * Response-action routes (docs/56 section 8): dispatcher-only recording of
 * typed, append-only response actions against an exception episode.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import { withTenant, type DbHandle } from "../../db/client.js";
import { recordResponseAction, responseEvents, RESPONSE_ACTION_TYPES } from "./response-actions.js";
import { deriveCommitmentOutcome, deriveExceptionResolution } from "./outcomes.js";

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
    if (result.conflict) {
      return reply.status(409).send({
        type: "https://privatefleet.example/errors/idempotency_conflict",
        title: "Idempotency key reused with different data",
        status: 409,
        code: "IDEMPOTENCY_CONFLICT",
        detail: "This idempotency key was already used for a different response action",
        uiMessage: "That key already recorded a different action. Nothing was written.",
      });
    }
    return { eventId: result.eventId, recorded: !result.replayed, replayed: result.replayed };
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

  // Derived exception resolution (docs/56 section 9): computed from the
  // episode lifecycle and the recorded response evidence. Read-only.
  app.get(
    "/v1/fleet/jobs/:jobId/episodes/:episodeId/resolution",
    { preHandler: guard },
    async (request, reply) => {
      const params = ParamsSchema.parse(request.params);
      const tenantId = request.auth?.tenantId ?? "";
      const episode = await withTenant(handle, tenantId, async (db) => {
        const rows = (await db.execute(sql`
          SELECT id, status, close_reason, resolution_note
          FROM exception_episodes
          WHERE tenant_id = ${tenantId} AND id = ${params.episodeId}
        `)) as unknown as Array<{
          id: string;
          status: string;
          close_reason: string | null;
          resolution_note: string | null;
        }>;
        return rows[0] ?? null;
      });
      if (!episode) {
        return reply.status(404).send({ code: "EPISODE_NOT_FOUND", uiMessage: "No such episode." });
      }
      const events = await responseEvents(handle, tenantId, params.episodeId);
      return {
        episodeId: episode.id,
        resolution: deriveExceptionResolution(episode, events),
      };
    },
  );

  // Derived commitment outcomes (docs/56 section 9): per stop, three
  // orthogonal dimensions, original and revised windows preserved.
  // Read-only; nothing is stored.
  app.get(
    "/v1/fleet/jobs/:jobId/commitment-outcomes",
    { preHandler: guard },
    async (request) => {
      const params = JobParamsSchema.parse(request.params);
      const tenantId = request.auth?.tenantId ?? "";
      return {
        stops: await withTenant(handle, tenantId, async (db) => {
          const job = (await db.execute(sql`
            SELECT id, status, service_type FROM jobs
            WHERE tenant_id = ${tenantId} AND id = ${params.jobId}
          `)) as unknown as Array<{ id: string; status: string; service_type: string }>;
          const jobRow = job[0];
          if (!jobRow) return [];
          const cancelled = jobRow.status === "cancelled";
          const stops = (await db.execute(sql`
            SELECT s.id, s.status, s.window_start, s.window_end
            FROM job_stops s
            WHERE s.tenant_id = ${tenantId} AND s.job_id = ${params.jobId}
            ORDER BY s.sequence
          `)) as unknown as Array<{
            id: string;
            status: string;
            window_start: Date | string;
            window_end: Date | string;
          }>;
          const stopIds = stops.map((stop) => stop.id);
          const evidence = stopIds.length === 0
            ? []
            : ((await db.execute(sql`
                SELECT stop_id, kind, captured_at FROM stop_evidence
                WHERE tenant_id = ${tenantId} AND stop_id IN ${stopIds}
              `)) as unknown as Array<{ stop_id: string; kind: string; captured_at: Date | string }>);
          const policy = (await db.execute(sql`
            SELECT service_type, require_recipient, require_signature, require_photo, require_failure_photo
            FROM proof_policies
            WHERE tenant_id = ${tenantId} AND service_type IN (${jobRow.service_type}, '*')
          `)) as unknown as Array<{
            service_type: string;
            require_recipient: boolean;
            require_signature: boolean;
            require_photo: boolean;
            require_failure_photo: boolean;
          }>;
          const chosenPolicy = policy.find((p) => p.service_type === jobRow.service_type) ?? policy[0];
          const requiredKinds = [
            ...(chosenPolicy?.require_recipient ? ["recipient"] : []),
            ...(chosenPolicy?.require_signature ? ["signature"] : []),
            ...(chosenPolicy?.require_photo ? ["photo"] : []),
            ...(chosenPolicy?.require_failure_photo ? ["failure_photo"] : []),
          ];
          // Confirmed reschedule revisions, mapped through their episode's stop.
          const revisions = (await db.execute(sql`
            SELECT e.stop_id, jv.payload
            FROM job_events jv
            JOIN exception_episodes e ON e.id = jv.episode_id
            WHERE jv.tenant_id = ${tenantId} AND jv.type = 'response.reschedule'
              AND jv.payload->>'stage' = 'confirmed'
          `)) as unknown as Array<{ stop_id: string; payload: unknown }>;
          return stops.map((stop) => {
            const stopEvidence = evidence.filter((row) => row.stop_id === stop.id);
            const capturedAt = stopEvidence
              .map((row) => new Date(row.captured_at).getTime())
              .reduce<number | null>((max, t) => (max === null || t > max ? t : max), null);
            const stopRevisions = revisions
              .filter((revision) => revision.stop_id === stop.id)
              .map((revision) => {
                const payload = revision.payload as {
                  windowStart?: string;
                  windowEnd?: string;
                  effectiveAt?: string | null;
                };
                return {
                  windowStart: payload.windowStart ?? "",
                  windowEnd: payload.windowEnd ?? "",
                  effectiveAt: payload.effectiveAt ?? null,
                };
              })
              .filter((revision) => revision.windowStart && revision.windowEnd);
            return {
              stopId: stop.id,
              outcome: deriveCommitmentOutcome({
                status: stop.status,
                jobCancelled: cancelled,
                completedCapturedAt: capturedAt === null ? null : new Date(capturedAt).toISOString(),
                windowStart: new Date(stop.window_start).toISOString(),
                windowEnd: new Date(stop.window_end).toISOString(),
                evidenceKinds: stopEvidence.map((row) => row.kind),
                requiredEvidenceKinds: requiredKinds,
                revisions: stopRevisions,
              }),
            };
          });
        }),
      };
    },
  );
}
