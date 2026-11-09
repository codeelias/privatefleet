/**
 * Notification routes (docs/54 R6): staff-facing read of every notification
 * attempt with its honest status, plus the transport configuration status.
 * No customer-facing surface here.
 */
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { NotificationService } from "./service.js";
import type { NotificationTransport } from "./service.js";
import { SmtpTransport } from "./smtp.js";

export function registerNotificationRoutes(
  app: FastifyInstance,
  auth: AuthService,
  service: NotificationService,
  transport: NotificationTransport,
): void {
  const guard = makeAuthGuard(auth);
  app.get("/v1/notifications", { preHandler: guard }, async (request) => {
    const tenantId = request.auth?.tenantId ?? "";
    return { notifications: await service.list(tenantId, 100) };
  });
  app.get("/v1/notifications/transport-status", { preHandler: guard }, async () => {
    if (transport instanceof SmtpTransport) {
      return transport.status();
    }
    return { configured: false, detail: "SMTP not configured" };
  });
}
