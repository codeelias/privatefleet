/**
 * Public tracking routes (Stage 4, commit 4): staff token management plus
 * the unauthenticated job-scoped read endpoint. Public access is rate limited
 * per token in-memory (single instance, as with the other pilot limiters).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { DbHandle } from "../../db/client.js";
import { createTrackingToken, publicTracking, revokeTrackingToken } from "./public-tracking.js";

const CreateBodySchema = z.object({ jobId: z.string().uuid() });
const TokenParamSchema = z.object({ token: z.string().min(20).max(64) });
const IdParamSchema = z.object({ id: z.string().uuid() });

class TokenRateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}
  allow(token: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(token) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(token, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(token, recent);
    if (this.hits.size > 10_000) {
      this.hits.clear();
    }
    return true;
  }
}

export function registerPublicTrackingRoutes(
  app: FastifyInstance,
  auth: AuthService,
  handle: DbHandle,
): void {
  const guard = makeAuthGuard(auth);
  const limiter = new TokenRateLimiter(10_000, 10);

  app.post("/v1/tracking-tokens", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/tracking_token_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "TRACKING_TOKEN_STAFF_ONLY",
        detail: "Tracking links require a staff account",
        uiMessage: "Ask dispatch to create a customer tracking link.",
      });
    }
    const body = CreateBodySchema.parse(request.body);
    const tenantId = request.auth?.tenantId ?? "";
    try {
      const created = await createTrackingToken(handle, tenantId, body.jobId);
      return { ...created, url: `/track/${created.token}` };
    } catch {
      return reply.status(404).send({
        type: "https://privatefleet.example/errors/job_not_found",
        title: "Request could not be completed",
        status: 404,
        code: "JOB_NOT_FOUND",
        detail: "That job does not exist in this workspace",
        uiMessage: "That job no longer exists.",
      });
    }
  });

  app.delete("/v1/tracking-tokens/:id", { preHandler: guard }, async (request, reply) => {
    const params = IdParamSchema.parse(request.params);
    const revoked = await revokeTrackingToken(
      handle,
      request.auth?.tenantId ?? "",
      params.id,
    );
    if (!revoked) {
      return reply.status(404).send({
        type: "https://privatefleet.example/errors/tracking_token_not_found",
        title: "Request could not be completed",
        status: 404,
        code: "TRACKING_TOKEN_NOT_FOUND",
        detail: "That tracking link was already revoked or does not exist",
        uiMessage: "That tracking link no longer exists.",
      });
    }
    return { revoked: true };
  });

  app.get("/v1/public/tracking/:token", async (request, reply) => {
    const params = TokenParamSchema.parse(request.params);
    if (!limiter.allow(params.token)) {
      reply.header("retry-after", "1");
      return reply.status(429).send({
        type: "https://privatefleet.example/errors/tracking_rate_limited",
        title: "Too many requests",
        status: 429,
        code: "TRACKING_RATE_LIMITED",
        detail: "The tracking page is refreshing too quickly",
        uiMessage: "Please wait a moment and refresh again.",
      });
    }
    const result = await publicTracking(handle, params.token);
    if (!result) {
      return reply.status(404).send({
        type: "https://privatefleet.example/errors/tracking_not_found",
        title: "Tracking link unavailable",
        status: 404,
        code: "TRACKING_NOT_FOUND",
        detail: "The tracking link is invalid, expired or revoked",
        uiMessage: "This tracking link is no longer available.",
      });
    }
    return result;
  });
}
