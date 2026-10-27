/**
 * Demo REST surface: scenario reset, fleet snapshot, assignment preview
 * and the authoritative assign command (docs/08.2, ADR-0007). Contract
 * schemas are parsed in-handler (single source of truth in contracts).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AssignRequestSchema,
  ScenarioNameSchema,
} from "@privatefleet/contracts";
import type { RealtimeBus } from "../../lib/realtime.js";
import type { DemoStore } from "./store.js";

type Params = Record<string, string | undefined>;

const ScenarioParamSchema = z.object({ id: ScenarioNameSchema });
const JobParamSchema = z.object({ jobId: z.string().uuid() });
const DriverBodySchema = z.object({ driverId: z.string().uuid() });
const IdempotencyHeaderSchema = z.object({
  "idempotency-key": z.string().uuid(),
});

export function registerDemoRoutes(
  app: FastifyInstance,
  store: DemoStore,
  bus: RealtimeBus,
): void {
  app.get("/v1/demo/scenarios", async () => ({
    scenarios: ["morning-rush", "emergency", "proof"],
    current: store.currentScenario,
  }));

  app.post("/v1/demo/scenarios/:id/reset", async (request) => {
    const params = ScenarioParamSchema.parse({ id: (request.params as Params).id });
    store.reset(params.id);
    return {
      scenarios: ["morning-rush", "emergency", "proof"],
      current: store.currentScenario,
    };
  });

  app.get("/v1/fleet/state", async () => store.fleetState());

  app.post("/v1/jobs/:jobId/assignment-preview", async (request) => {
    const params = JobParamSchema.parse({ jobId: (request.params as Params).jobId });
    const body = DriverBodySchema.parse(request.body);
    return store.preview(params.jobId, body.driverId);
  });

  app.post("/v1/jobs/:jobId/assign", async (request) => {
    const params = JobParamSchema.parse({ jobId: (request.params as Params).jobId });
    const body = AssignRequestSchema.parse(request.body);
    const headers = IdempotencyHeaderSchema.parse({
      "idempotency-key": request.headers["idempotency-key"],
    });
    const result = store.assign(params.jobId, body.driverId, headers["idempotency-key"]);
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });
}
