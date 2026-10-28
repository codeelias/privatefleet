/**
 * Auth routes (Phase 2): register, login, refresh, logout, me.
 * Bodies are validated against the shared contracts (ADR-0003).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  LoginRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
} from "@privatefleet/contracts";
import { AuthError, type AuthService } from "./service.js";
import { makeAuthGuard } from "./guard.js";
import type { AuthAttemptLimiter } from "./rate-limit.js";

function rateLimited(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  reply.header("retry-after", String(retryAfterSeconds));
  return reply.status(429).send({
    type: "https://privatefleet.example/errors/auth-rate-limited",
    title: "Too many attempts",
    status: 429,
    code: "AUTH_RATE_LIMITED",
    detail: "Authentication attempts are temporarily throttled",
    uiMessage: "Too many sign-in attempts. Wait a moment and try again.",
  });
}

function staffKey(slug: string, email: string): string {
  return "staff:" + slug.trim().toLowerCase() + ":" + email.trim().toLowerCase();
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  limiter: AuthAttemptLimiter,
): void {
  app.post("/v1/auth/register", async (request) => {
    const input = RegisterRequestSchema.parse(request.body);
    return auth.register(input);
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const input = LoginRequestSchema.parse(request.body);
    const accountKey = staffKey(input.tenantSlug, input.email);
    const ipKey = "ip:" + request.ip;
    const decision = limiter.check(accountKey, ipKey);
    if (!decision.allowed) {
      return rateLimited(reply, decision.retryAfterSeconds);
    }
    try {
      const session = await auth.login(input);
      limiter.recordSuccess(accountKey);
      return session;
    } catch (err) {
      if (
        err instanceof AuthError &&
        (err.code === "INVALID_CREDENTIALS" || err.code === "TENANT_NOT_FOUND")
      ) {
        limiter.recordFailure(accountKey, ipKey);
      }
      throw err;
    }
  });

  app.post("/v1/auth/refresh", async (request) => {
    const input = RefreshRequestSchema.parse(request.body);
    return auth.refresh(input.refreshToken);
  });

  app.post("/v1/auth/logout", async (request) => {
    const input = RefreshRequestSchema.parse(request.body);
    await auth.logout(input.refreshToken);
    return { loggedOut: true };
  });

  app.get("/v1/auth/me", { preHandler: makeAuthGuard(auth) }, async (request) => {
    return { auth: request.auth };
  });
}
