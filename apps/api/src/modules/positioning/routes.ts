/**
 * Diagnostics-only endpoint for the PF-TIDE shadow estimator. Read-only;
 * never influences production positioning responses.
 */
import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/service";
import { makeAuthGuard } from "../auth/guard";
import { shadowReports } from "./shadow-runner";

export function registerPositioningDiagnosticsRoutes(app: FastifyInstance, auth: AuthService): void {
  const guard = makeAuthGuard(auth);

  app.get("/v1/diagnostics/positioning-shadow", { preHandler: guard }, async (request, reply) => {
    if (request.auth?.role === "driver") {
      return reply.status(403).send({
        type: "https://privatefleet.example/errors/diagnostics_staff_only",
        title: "Request could not be completed",
        status: 403,
        code: "DIAGNOSTICS_STAFF_ONLY",
        detail: "Positioning diagnostics require a staff account",
        uiMessage: "Positioning diagnostics are available to dispatchers only.",
      });
    }
    return { shadow: shadowReports() };
  });
}
