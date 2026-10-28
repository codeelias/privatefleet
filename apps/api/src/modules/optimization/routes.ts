/**
 * Phase 5 optimization endpoints (docs/10.2): propose with OSRM/VROOM and
 * publish an approved version. Demo endpoints stay in the demo module.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/service.js";
import { makeAuthGuard } from "../auth/guard.js";
import type { DbHandle } from "../../db/client.js";
import { RoutingError, type RoutingClients } from "../routing/types.js";
import { approveProposal, createProposal, OptimizationError } from "./service.js";
import { approveFleetProposal, createFleetProposal } from "./fleet-service.js";

const RunBodySchema = z.object({ driverId: z.string().uuid() });
const ApproveBodySchema = z.object({
  expectedRouteVersion: z.number().int().nonnegative().optional(),
});
const RunParamSchema = z.object({ runId: z.string().uuid() });
const FleetRunBodySchema = z.object({
  driverIds: z.array(z.string().uuid()).min(1).optional(),
});

function requireDispatcher(
  request: { auth?: { role: string } },
  reply: FastifyReply,
): boolean {
  if (request.auth?.role === "driver") {
    void reply.status(403).send({
      type: "https://privatefleet.example/errors/dispatcher_only",
      title: "Dispatcher action",
      status: 403,
      code: "DISPATCHER_ONLY",
      detail: "Optimization is a dispatcher action",
      uiMessage: "Ask dispatch to run the optimization.",
    });
    return false;
  }
  return true;
}

export function registerOptimizationRoutes(
  app: FastifyInstance,
  auth: AuthService,
  handle: DbHandle,
  clientsProvider: () => RoutingClients,
): void {
  const guard = makeAuthGuard(auth);

  app.post("/v1/optimization/run", { preHandler: guard }, async (request, reply) => {
    if (!requireDispatcher(request, reply)) {
      return reply;
    }
    const tenantId = request.auth?.tenantId ?? "";
    const body = RunBodySchema.parse(request.body);
    try {
      return await createProposal(handle, clientsProvider(), tenantId, body.driverId);
    } catch (err) {
      if (err instanceof RoutingError) {
        const status = err.code === "ROUTING_NOT_CONFIGURED" ? 503 : 502;
        return reply.status(status).send({
          type: `https://privatefleet.example/errors/${err.code.toLowerCase()}`,
          title: "Routing unavailable",
          status,
          code: err.code,
          detail: err.message,
          uiMessage:
            err.code === "ROUTING_NOT_CONFIGURED"
              ? "Live routing is not configured on this deployment. Manual dispatch still works."
              : "The routing engine could not complete this plan. Try again in a moment.",
        });
      }
      if (err instanceof OptimizationError) {
        if (err.code === "DRIVER_NOT_FOUND") {
          return reply.status(404).send({
            type: "https://privatefleet.example/errors/driver-not-found",
            title: "Driver not found",
            status: 404,
            code: err.code,
            detail: "The driver does not exist in this tenant",
            uiMessage: "That driver could not be found. Refresh and try again.",
          });
        }
        if (err.code === "NO_ASSIGNED_STOPS") {
          return reply.status(409).send({
            type: "https://privatefleet.example/errors/no-assigned-stops",
            title: "Nothing to optimise",
            status: 409,
            code: err.code,
            detail: "The driver has no pending assigned pickup/dropoff pairs",
            uiMessage: "Assign at least one pickup and dropoff to this driver first.",
          });
        }
        return reply.status(422).send({
          type: "https://privatefleet.example/errors/plan-infeasible",
          title: "Plan infeasible",
          status: 422,
          code: err.code,
          detail: "The solver could not place every shipment",
          uiMessage: "This plan cannot be completed within the constraints. Adjust assignments.",
        });
      }
      throw err;
    }
  });

  app.post(
    "/v1/optimization/:runId/approve",
    { preHandler: guard },
    async (request, reply) => {
      if (!requireDispatcher(request, reply)) {
        return reply;
      }
      const tenantId = request.auth?.tenantId ?? "";
      const params = RunParamSchema.parse(request.params);
      const body = ApproveBodySchema.parse(request.body ?? {});
      try {
        return await approveProposal(
          handle,
          tenantId,
          params.runId,
          body.expectedRouteVersion,
        );
      } catch (err) {
        if (err instanceof OptimizationError) {
          if (err.code === "RUN_NOT_FOUND") {
            return reply.status(404).send({
              type: "https://privatefleet.example/errors/run-not-found",
              title: "Proposal not found",
              status: 404,
              code: err.code,
              detail: "No optimization run with that id",
              uiMessage: "That proposal no longer exists. Run the optimization again.",
            });
          }
          if (err.code === "ROUTE_VERSION_STALE") {
            return reply.status(409).send({
              type: "https://privatefleet.example/errors/route-version-stale",
              title: "Plan changed",
              status: 409,
              code: "ROUTE_VERSION_STALE",
              detail: "A newer route version exists",
              uiMessage:
                "This plan changed elsewhere. Refresh and preview the new plan before publishing.",
            });
          }
        }
        throw err;
      }
    },
  );

  function optimizationFailure(err: unknown, reply: FastifyReply): FastifyReply | null {
    if (err instanceof RoutingError) {
      const status = err.code === "ROUTING_NOT_CONFIGURED" ? 503 : 502;
      return reply.status(status).send({
        type: "https://privatefleet.example/errors/" + err.code.toLowerCase(),
        title: "Routing unavailable",
        status,
        code: err.code,
        detail: err.message,
        uiMessage:
          err.code === "ROUTING_NOT_CONFIGURED"
            ? "Live routing is not configured on this deployment. Manual dispatch still works."
            : "The routing engine could not complete this plan. Try again in a moment.",
      });
    }
    if (err instanceof OptimizationError) {
      if (err.code === "RUN_NOT_FOUND") {
        return reply.status(404).send({
          type: "https://privatefleet.example/errors/run-not-found",
          title: "Proposal not found",
          status: 404,
          code: err.code,
          detail: "No fleet optimization run with that id",
          uiMessage: "That proposal no longer exists. Run the optimization again.",
        });
      }
      if (err.code === "ROUTE_VERSION_STALE") {
        return reply.status(409).send({
          type: "https://privatefleet.example/errors/route-version-stale",
          title: "Plan changed",
          status: 409,
          code: "ROUTE_VERSION_STALE",
          detail: "The fleet plan changed after this proposal was generated",
          uiMessage:
            "This plan changed elsewhere. Refresh and preview the new plan before publishing.",
        });
      }
      if (err.code === "NO_ASSIGNED_STOPS") {
        return reply.status(409).send({
          type: "https://privatefleet.example/errors/no-assigned-stops",
          title: "Nothing to optimise",
          status: 409,
          code: err.code,
          detail: "No eligible shipments or vehicles",
          uiMessage: "Assign pickup/dropoff pairs to drivers with vehicles first.",
        });
      }
      return reply.status(422).send({
        type: "https://privatefleet.example/errors/plan-infeasible",
        title: "Plan infeasible",
        status: 422,
        code: err.code,
        detail: "The solver could not produce a fleet plan",
        uiMessage: "The fleet plan is infeasible. Adjust assignments and try again.",
      });
    }
    return null;
  }

  app.post("/v1/optimization/fleet-run", { preHandler: guard }, async (request, reply) => {
    if (!requireDispatcher(request, reply)) {
      return reply;
    }
    const tenantId = request.auth?.tenantId ?? "";
    const body = FleetRunBodySchema.parse(request.body ?? {});
    try {
      return await createFleetProposal(handle, clientsProvider(), tenantId, {
        ...(body.driverIds ? { driverIds: body.driverIds } : {}),
      });
    } catch (err) {
      const failure = optimizationFailure(err, reply);
      if (failure) {
        return failure;
      }
      throw err;
    }
  });

  app.post(
    "/v1/optimization/fleet/:runId/approve",
    { preHandler: guard },
    async (request, reply) => {
      if (!requireDispatcher(request, reply)) {
        return reply;
      }
      const tenantId = request.auth?.tenantId ?? "";
      const params = RunParamSchema.parse(request.params);
      const body = ApproveBodySchema.parse(request.body ?? {});
      try {
        return await approveFleetProposal(
          handle,
          tenantId,
          params.runId,
          body.expectedRouteVersion,
        );
      } catch (err) {
        const failure = optimizationFailure(err, reply);
        if (failure) {
          return failure;
        }
        throw err;
      }
    },
  );
}
