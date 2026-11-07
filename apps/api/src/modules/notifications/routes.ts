/**
 * Notification routes (docs/54 R6): staff-facing read of every notification
 * attempt with its honest status. No customer-facing surface here.
 */
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { NotificationService } from "./service.js";

export function registerNotificationRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: NotificationService,
): void {
  const guard = makeAuthGuard(auth);
  app.get("/v1/notifications", { preHandler: guard }, async (request) => {
    const tenantId = request.auth?.tenantId ?? "";
    return { notifications: await service.list(tenantId, 100) };
  });
}
