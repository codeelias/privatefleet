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
const BenchmarkBodySchema = z.object({ count: z.number().int().min(1).max(400) });
const StopParamSchema = z.object({
  jobId: z.string().uuid(),
  stopId: z.string().uuid(),
});
const CompleteBodySchema = z.object({
  driverId: z.string().uuid(),
  recipientName: z.string().optional(),
  notes: z.string().optional(),
});
const SkipBodySchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().min(1),
});
const DriverParamSchema = z.object({ driverId: z.string().uuid() });
const RunParamSchema = z.object({ runId: z.string().uuid() });
const AlertParamSchema = z.object({ alertId: z.string().uuid() });
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

  app.post("/v1/demo/load", async (request) => {
    const body = BenchmarkBodySchema.parse(request.body);
    const vehicles = store.loadBenchmarkVehicles(body.count);
    return { vehicles };
  });

  app.delete("/v1/demo/load", async () => {
    store.clearBenchmarkVehicles();
    return { vehicles: 0 };
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

  app.post("/v1/optimization/run", async (request) => {
    const body = DriverBodySchema.parse(request.body);
    return store.runOptimization(body.driverId);
  });

  app.post("/v1/optimization/:runId/approve", async (request) => {
    const params = RunParamSchema.parse({ runId: (request.params as Params).runId });
    const result = store.approve(params.runId);
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });

  app.post("/v1/alerts/:alertId/acknowledge", async (request) => {
    const params = AlertParamSchema.parse({ alertId: (request.params as Params).alertId });
    const result = store.actOnAlert(params.alertId, "acknowledge");
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });

  app.post("/v1/alerts/:alertId/resolve", async (request) => {
    const params = AlertParamSchema.parse({ alertId: (request.params as Params).alertId });
    const result = store.actOnAlert(params.alertId, "resolve");
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });

  // ---- Driver app commands (server-authoritative, docs/08.2) ----
  app.post("/v1/driver/shift/start", async (request) => {
    const body = DriverBodySchema.parse(request.body);
    return store.startShift(body.driverId);
  });

  app.get("/v1/driver/:driverId/queue", async (request) => {
    const params = DriverParamSchema.parse({
      driverId: (request.params as Params).driverId,
    });
    return store.driverQueue(params.driverId);
  });

  app.post("/v1/jobs/:jobId/stops/:stopId/arrive", async (request) => {
    const params = StopParamSchema.parse(request.params as Params);
    const body = DriverBodySchema.parse(request.body);
    const result = store.arrive(params.jobId, params.stopId, body.driverId);
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });

  app.post("/v1/jobs/:jobId/stops/:stopId/complete", async (request) => {
    const params = StopParamSchema.parse(request.params as Params);
    const body = CompleteBodySchema.parse(request.body);
    const result = store.complete(params.jobId, params.stopId, body.driverId, {
      recipientName: body.recipientName,
      notes: body.notes,
    });
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });

  app.post("/v1/jobs/:jobId/stops/:stopId/skip", async (request) => {
    const params = StopParamSchema.parse(request.params as Params);
    const body = SkipBodySchema.parse(request.body);
    const result = store.skip(params.jobId, params.stopId, body.driverId, body.reason);
    for (const event of store.drainOutbox()) {
      bus.publishBusiness(event);
    }
    return result;
  });
}

