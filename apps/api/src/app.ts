/**
 * Composition root (docs/04.2): buildApp() is the testable Fastify
 * instance; demo modules register when DEMO_MODE=true (ADR-0007).
 * Contract schemas from @privatefleet/contracts are validated inside
 * handlers with zod (single source of truth, no serializer coupling).
 * Errors map to RFC 9457 responses with a conversational uiMessage
 * (ADR-0011) - raw internal errors never reach a screen.
 */
import Fastify from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { createRealtimeBus, type RealtimeBus } from "./lib/realtime.js";
import { registerDemoRoutes } from "./modules/demo/routes.js";
import { DemoStore } from "./modules/demo/store.js";

export interface DemoContext {
  store: DemoStore;
  bus: RealtimeBus;
}

const ERROR_MAP: Record<string, { status: number; uiMessage: string }> = {
  JOB_OR_DRIVER_NOT_FOUND: {
    status: 404,
    uiMessage: "That job or driver no longer exists. Refresh the board and try again.",
  },
  JOB_ASSIGNMENT_CONFLICT: {
    status: 409,
    uiMessage: "Wait - this job was just assigned to someone else. Reload to see the latest state.",
  },
  DRIVER_HAS_NO_VEHICLE: {
    status: 409,
    uiMessage: "That driver has no vehicle assigned. Ask dispatch to fix the roster.",
  },
};

export function buildApp(config: AppConfig): {
  app: ReturnType<typeof Fastify>;
  demo: DemoContext | undefined;
} {
  const app = Fastify({ logger: true });

  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const path = first ? first.path.join(".") : "request";
      const message = first ? first.message : "invalid input";
      return reply.status(400).send({
        type: "https://privatefleet.example/errors/validation",
        title: "Invalid request",
        status: 400,
        code: "VALIDATION_ERROR",
        detail: `${path}: ${message}`,
        uiMessage: `Check the highlighted fields and try again (${path}).`,
      });
    }
    const code = err instanceof Error ? err.message : "";
    const mapped = ERROR_MAP[code];
    if (mapped) {
      return reply.status(mapped.status).send({
        type: `https://privatefleet.example/errors/${code.toLowerCase()}`,
        title: "Request could not be completed",
        status: mapped.status,
        code,
        detail: mapped.uiMessage,
        uiMessage: mapped.uiMessage,
      });
    }
    app.log.error(err);
    return reply.status(500).send({
      type: "https://privatefleet.example/errors/internal",
      title: "Internal error",
      status: 500,
      code: "INTERNAL",
      detail: "Unexpected error",
      uiMessage: "Something went wrong on our side. Your change is safe - retry in a moment.",
    });
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async () => ({
    status: "ok",
    demoMode: config.demoMode,
    version: config.version,
  }));

  app.get("/v1/meta", async () => ({
    name: config.name,
    version: config.version,
    demoMode: config.demoMode,
  }));

  let demo: DemoContext | undefined;
  if (config.demoMode) {
    const store = new DemoStore("morning-rush");
    const bus = createRealtimeBus(app.server);
    registerDemoRoutes(app, store, bus);
    demo = { store, bus };
  }

  return { app, demo };
}
