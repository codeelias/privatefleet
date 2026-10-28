/**
 * Phase 3 driver device routes (docs/06): a driver token only sees its
 * own queue and can only start its own shift. Job actions live in the
 * fleet module and enforce the token's driver identity there.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
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
): void {
  const guard = makeAuthGuard(auth);

  app.post("/v1/auth/driver-login", async (request) => {
    const { DriverLoginRequestSchema } = await import("@privatefleet/contracts");
    const input = DriverLoginRequestSchema.parse(request.body);
    return auth.driverLogin(input);
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
}
