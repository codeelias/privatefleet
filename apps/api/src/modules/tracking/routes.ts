/**
 * Phase 4 telemetry endpoint (docs/02 B, docs/09): driver devices only;
 * the vehicle is derived from the authenticated driver, never the body.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { TelemetryBatchSchema } from "@privatefleet/contracts";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { DbHandle } from "../../db/client.js";
import type { RealtimeBus } from "../../lib/realtime.js";
import { ingestTelemetry, TrackingError } from "./service.js";

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
      detail: "Telemetry requires a driver device session",
      uiMessage: "Sign in on your driver device to report location.",
    });
    return null;
  }
  return request.auth.userId;
}

export function registerTrackingRoutes(
  app: FastifyInstance,
  auth: AuthService,
  bus: RealtimeBus,
  handle: DbHandle,
): void {
  const guard = makeAuthGuard(auth);

  app.post("/v1/telemetry", { preHandler: guard }, async (request, reply) => {
    const driverId = requireDriver(request, reply);
    if (!driverId) {
      return reply;
    }
    const tenantId = request.auth?.tenantId ?? "";
    const batch = TelemetryBatchSchema.parse(request.body);
    try {
      const outcome = await ingestTelemetry(handle, tenantId, driverId, batch);
      for (const position of outcome.positions) {
        bus.publishTelemetry(tenantId, position);
      }
      return outcome.result;
    } catch (err) {
      if (err instanceof TrackingError) {
        return reply.status(409).send({
          type: "https://privatefleet.example/errors/driver-has-no-vehicle",
          title: "No vehicle assigned",
          status: 409,
          code: "DRIVER_HAS_NO_VEHICLE",
          detail: "The driver has no assigned vehicle for telemetry",
          uiMessage: "Ask dispatch to assign you a vehicle before sharing location.",
        });
      }
      throw err;
    }
  });
}
