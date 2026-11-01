/**
 * Phase 3 driver device routes (docs/06): a driver token only sees its
 * own queue and can only start its own shift. Job actions live in the
 * fleet module and enforce the token's driver identity there.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { DbHandle } from "../../db/client.js";
import {
  createWorkRequest,
  getDriverWorkRequest,
  WorkRequestError,
} from "./work-requests.js";
import { AuthError, type AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { AuthAttemptLimiter } from "../auth/rate-limit.js";
import type { PgFleetService } from "../fleet/pg-service.js";

function requireDriver(
  request: { auth?: { role: string; userId: string } },
  reply: FastifyReply,
): string | null {
  if (request.auth?.role !== "driver") {
    void reply.status(403).send({
      type: "https://privatefleet.example/errors/driver_device_only",
      title: "Driver devices only",
      status: 403,
      code: "DRIVER_DEVICE_ONLY",
      detail: "This endpoint requires a driver device session",
      uiMessage: "Sign in on your driver device to use this screen.",
    });
    return null;
  }
  return request.auth.userId;
}

export function registerDriverDeviceRoutes(
  app: FastifyInstance,
  auth: AuthService,
  fleet: PgFleetService,
  limiter: AuthAttemptLimiter,
  handle: DbHandle,
): void {
  const guard = makeAuthGuard(auth);

  app.post("/v1/auth/driver-login", async (request, reply) => {
    const { DriverLoginRequestSchema } = await import("@privatefleet/contracts");
    const input = DriverLoginRequestSchema.parse(request.body);
    const accountKey =
      "driver:" +
      input.tenantSlug.trim().toLowerCase() +
      ":" +
      input.driverId.trim().toLowerCase();
    const ipKey = "ip:" + request.ip;
    const decision = limiter.check(accountKey, ipKey);
    if (!decision.allowed) {
      reply.header("retry-after", String(decision.retryAfterSeconds));
      return reply.status(429).send({
        type: "https://privatefleet.example/errors/auth-rate-limited",
        title: "Too many attempts",
        status: 429,
        code: "AUTH_RATE_LIMITED",
        detail: "Authentication attempts are temporarily throttled",
        uiMessage: "Too many sign-in attempts. Wait a moment and try again.",
      });
    }
    try {
      const session = await auth.driverLogin(input);
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

  app.get("/v1/driver/queue", { preHandler: guard }, async (request, reply) => {
    const driverId = requireDriver(request, reply);
    if (!driverId) {
      return reply;
    }
    const tenantId = request.auth?.tenantId ?? "";
    return fleet.driverQueue(tenantId, driverId);
  });

  app.post("/v1/driver/shift/start", { preHandler: guard }, async (request, reply) => {
    const driverId = requireDriver(request, reply);
    if (!driverId) {
      return reply;
    }
    const tenantId = request.auth?.tenantId ?? "";
    return fleet.startShift(tenantId, driverId);
  });

  app.get("/v1/driver/work-requests", { preHandler: guard }, async (request, reply) => {
    const driverId = requireDriver(request, reply);
    if (!driverId) return reply;
    return getDriverWorkRequest(handle, request.auth?.tenantId ?? "", driverId);
  });

  app.post("/v1/driver/work-requests", { preHandler: guard }, async (request, reply) => {
    const driverId = requireDriver(request, reply);
    if (!driverId) return reply;
    const body = z
      .object({ note: z.string().max(300).optional() })
      .parse(request.body ?? {});
    try {
      return await createWorkRequest(
        handle,
        request.auth?.tenantId ?? "",
        driverId,
        body.note,
      );
    } catch (err) {
      if (err instanceof WorkRequestError) {
        const status = err.code === "WORK_REQUEST_EXISTS" ? 409 : 422;
        return reply.status(status).send({
          type: "https://privatefleet.example/errors/work-request",
          title: "Work request",
          status,
          code: err.code,
          detail: err.message,
          uiMessage:
            err.code === "WORK_REQUEST_EXISTS"
              ? "You already have a pending request. Dispatch will respond shortly."
              : "You cannot request more work in your current state.",
        });
      }
      throw err;
    }
  });}


