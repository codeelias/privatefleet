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
import { closeDb, createDb, type DbHandle } from "./db/client.js";
import { createRealtimeBus, type RealtimeBus } from "./lib/realtime.js";
import { AuthError, AuthService } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { FleetError, PgFleetService } from "./modules/fleet/pg-service.js";
import { registerFleetRoutes } from "./modules/fleet/routes.js";
import { registerDriverDeviceRoutes } from "./modules/driver/routes.js";
import { registerDemoRoutes } from "./modules/demo/routes.js";
import { DemoStore } from "./modules/demo/store.js";

export interface DemoContext {
  store: DemoStore;
  bus: RealtimeBus;
}

export interface PostgresContext {
  db: DbHandle;
  auth: AuthService;
  fleet: PgFleetService;
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
  OPTIMIZATION_RUN_NOT_FOUND: {
    status: 404,
    uiMessage: "That optimisation proposal is gone. Run a new optimisation and try again.",
  },
  ALERT_NOT_FOUND: {
    status: 404,
    uiMessage: "That alert was already handled. Refresh the list.",
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    uiMessage: "This action was already processed with different data. Refresh and try again.",
  },
  STOP_NOT_FOUND: {
    status: 404,
    uiMessage: "That stop no longer exists. Refresh your queue.",
  },
  STOP_NOT_ASSIGNED_TO_DRIVER: {
    status: 403,
    uiMessage: "This stop is not assigned to you. Pull to refresh your queue.",
  },
  INVALID_STOP_TRANSITION: {
    status: 409,
    uiMessage: "Wait - this stop already changed state. Refresh your queue.",
  },
};

export function buildApp(config: AppConfig): {
  app: ReturnType<typeof Fastify>;
  demo: DemoContext | undefined;
  postgres: PostgresContext | undefined;
} {
  const app = Fastify({ logger: { level: config.logLevel } });

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
    if (err instanceof AuthError) {
      const status =
        err.code === "TENANT_NOT_FOUND" ? 404 : err.code === "REFRESH_INVALID" ? 401 : 401;
      const uiMessage =
        err.code === "TENANT_NOT_FOUND"
          ? "That workspace was not found. Check the name and try again."
          : err.code === "REFRESH_INVALID"
            ? "Your session has expired. Please sign in again."
            : "Email or password is incorrect.";
      return reply.status(status).send({
        type: `https://privatefleet.example/errors/${err.code.toLowerCase()}`,
        title: status === 404 ? "Not found" : "Authentication failed",
        status,
        code: err.code,
        detail: err.message,
        uiMessage,
      });
    }
    if (err instanceof FleetError) {
      const mapped = ERROR_MAP[err.code];
      if (mapped) {
        return reply.status(mapped.status).send({
          type: `https://privatefleet.example/errors/${err.code.toLowerCase()}`,
          title: "Request could not be completed",
          status: mapped.status,
          code: err.code,
          detail: mapped.uiMessage,
          uiMessage: mapped.uiMessage,
        });
      }
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
    repositoryMode: config.repositoryMode,
    version: config.version,
  }));

  app.get("/v1/meta", async () => ({
    name: config.name,
    version: config.version,
    demoMode: config.demoMode,
    repositoryMode: config.repositoryMode,
  }));

  let demo: DemoContext | undefined;
  let postgres: PostgresContext | undefined;

  if (config.repositoryMode === "postgres") {
    if (!config.databaseUrl) {
      throw new Error("postgres repository mode requires DATABASE_URL");
    }
    const db = createDb(config.databaseUrl);
    const bus = createRealtimeBus(app.server);
    const auth = new AuthService(config, db);
    const fleet = new PgFleetService(db, bus);
    registerAuthRoutes(app, auth);
    registerFleetRoutes(app, auth, fleet);
    registerDriverDeviceRoutes(app, auth, fleet);
    app.addHook("onClose", async () => {
      await closeDb(db);
    });
    postgres = { db, auth, fleet, bus };
  } else {
    const store = new DemoStore("morning-rush");
    const bus = createRealtimeBus(app.server);
    registerDemoRoutes(app, store, bus);
    demo = { store, bus };
  }

  return { app, demo, postgres };
}

