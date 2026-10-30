/**
 * Composition root (docs/04.2): buildApp() is the testable Fastify
 * instance; demo modules register when DEMO_MODE=true (ADR-0007).
 * Contract schemas from @privatefleet/contracts are validated inside
 * handlers with zod (single source of truth, no serializer coupling).
 * Errors map to RFC 9457 responses with a conversational uiMessage
 * (ADR-0011) - raw internal errors never reach a screen.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { closeDb, createDb, type DbHandle } from "./db/client.js";
import { createRealtimeBus, type RealtimeBus } from "./lib/realtime.js";
import { AuthError, AuthService } from "./modules/auth/service.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { AuthAttemptLimiter } from "./modules/auth/rate-limit.js";
import { FleetError, PgFleetService } from "./modules/fleet/pg-service.js";
import { registerFleetRoutes } from "./modules/fleet/routes.js";
import { ImportError } from "./modules/import/csv.js";
import { registerDriverDeviceRoutes } from "./modules/driver/routes.js";
import { registerTrackingRoutes } from "./modules/tracking/routes.js";
import { registerOptimizationRoutes } from "./modules/optimization/routes.js";
import { createRoutingClients } from "./modules/routing/factory.js";
import { RoutingError } from "./modules/routing/types.js";
import { registerDemoRoutes } from "./modules/demo/routes.js";
import { EvidenceError, EvidenceService } from "./modules/evidence/service.js";
import { EvidenceStore } from "./modules/evidence/storage.js";
import { registerEvidenceRoutes } from "./modules/evidence/routes.js";
import { registerReportRoutes } from "./modules/reports/routes.js";
import { DemoStore } from "./modules/demo/store.js";

export interface DemoContext {
  store: DemoStore;
  bus: RealtimeBus;
}

export interface PostgresContext {
  db: DbHandle;
  auth: AuthService;
  fleet: PgFleetService;
  evidence: EvidenceService;
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
  EVIDENCE_REQUIRED: {
    status: 422,
    uiMessage: "Capture the required proof before completing this stop.",
  },
  EVIDENCE_ALREADY_RECORDED: {
    status: 409,
    uiMessage: "Different proof is already recorded for this stop.",
  },
  FAILURE_REASON_INVALID: {
    status: 400,
    uiMessage: "Choose a valid failure reason.",
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
  const app = Fastify({
    logger: { level: config.logLevel },
    // Explicit request ceiling; telemetry batches are <= 50 samples and the
    // largest normal payload is well under 256 KiB.
    bodyLimit: 262_144,
  });
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    return payload;
  });
  if (config.corsOrigins.length > 0) {
    // Only explicit origins: the Expo web build runs on its own port.
    void app.register(cors, { origin: config.corsOrigins });
  }

  app.setErrorHandler((err, _request, reply) => {
    const fastifyCode = (err as { code?: unknown }).code;
    if (
      fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      fastifyCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
      fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE"
    ) {
      const tooLarge = fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE";
      const unsupported = fastifyCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE";
      const status = tooLarge ? 413 : unsupported ? 415 : 400;
      return reply.status(status).send({
        type: "https://privatefleet.example/errors/invalid-request-body",
        title: tooLarge ? "Payload too large" : "Invalid request body",
        status,
        code: tooLarge
          ? "PAYLOAD_TOO_LARGE"
          : unsupported
            ? "UNSUPPORTED_MEDIA_TYPE"
            : "INVALID_JSON",
        detail: "The request body could not be parsed",
        uiMessage: tooLarge
          ? "That request is too large. Reduce it and try again."
          : unsupported
            ? "Use JSON with content-type application/json."
            : "The request body is not valid JSON. Check it and try again.",
      });
    }
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
    if (err instanceof EvidenceError) {
      const status =
        err.code === "EVIDENCE_REQUIRED"
          ? 422
          : err.code === "EVIDENCE_ALREADY_RECORDED"
            ? 409
            : err.code === "EVIDENCE_TOO_LARGE"
              ? 413
              : err.code === "STOP_NOT_FOUND"
                ? 404
                : err.code === "STOP_NOT_ASSIGNED_TO_DRIVER"
                  ? 403
                  : 400;
      return reply.status(status).send({
        type: `https://privatefleet.example/errors/${err.code.toLowerCase()}`,
        title: status === 422 ? "Evidence required" : "Evidence could not be recorded",
        status,
        code: err.code,
        detail: err.message,
        uiMessage:
          err.code === "EVIDENCE_REQUIRED"
            ? "Capture the required proof before completing this stop."
            : err.code === "EVIDENCE_TOO_LARGE"
              ? "That file is too large. Choose a smaller photo."
              : err.code === "STOP_NOT_ASSIGNED_TO_DRIVER"
                ? "This stop is not assigned to you."
                : "The evidence could not be saved. Try again.",
      });
    }
    if (err instanceof ImportError) {
      const status =
        err.code === "IMPORT_DUPLICATES"
          ? 409
          : err.code === "IMPORT_TOO_LARGE"
            ? 413
            : err.code === "IMPORT_INVALID"
              ? 400
              : 422;
      return reply.status(status).send({
        type: `https://privatefleet.example/errors/${err.code.toLowerCase()}`,
        title: status === 409 ? "Duplicate job references" : "Import could not be validated",
        status,
        code: err.code,
        detail: err.message,
        uiMessage:
          status === 409
            ? "One or more job references already exist. Change them and preview again."
            : status === 413
              ? "That CSV is too large. Split it into smaller batches."
              : status === 400
                ? "The CSV could not be read. Check the headers and rows."
                : "Fix the highlighted rows and preview again.",
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
    const fastifyStatus =
      typeof (err as { statusCode?: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : undefined;
    if (fastifyStatus !== undefined && fastifyStatus >= 400 && fastifyStatus < 500) {
      const fastifyCode =
        (err as { code?: string }).code ?? (fastifyStatus === 400 ? "BAD_REQUEST" : "REQUEST_REJECTED");
      return reply.status(fastifyStatus).send({
        type: `https://privatefleet.example/errors/${fastifyCode.toLowerCase()}`,
        title: "Request could not be completed",
        status: fastifyStatus,
        code: fastifyCode,
        detail: err instanceof Error ? err.message : "Request rejected",
        uiMessage:
          fastifyStatus === 400
            ? "The request was not understood. Refresh and try again."
            : "That request was rejected. Refresh and try again.",
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
    const auth = new AuthService(config, db);
    const bus = createRealtimeBus(app.server, {
      demoMode: false,
      coalesceMs: 1_000,
      verifyToken: (token) => auth.verifyAccess(token),
    });
    const fleet = new PgFleetService(db, bus);
    const evidence = new EvidenceService(db, new EvidenceStore(config.evidenceDir));
    const authAttemptLimiter = new AuthAttemptLimiter({
      windowMs: config.authAttemptWindowSeconds * 1000,
      maxAccountFailures: config.authMaxAttemptsAccount,
      maxIpFailures: config.authMaxAttemptsIp,
      maxEntries: 10_000,
    });
    registerAuthRoutes(app, auth, authAttemptLimiter);
    registerFleetRoutes(app, auth, fleet, config.importServiceArea);
    registerEvidenceRoutes(app, auth, fleet, evidence);
    registerReportRoutes(app, auth, db);
    registerDriverDeviceRoutes(app, auth, fleet, authAttemptLimiter);
    registerTrackingRoutes(app, auth, bus, db);
    const routingClients =
      config.osrmBaseUrl && config.vroomBaseUrl
        ? createRoutingClients({
            osrmBaseUrl: config.osrmBaseUrl,
            vroomBaseUrl: config.vroomBaseUrl,
          })
        : null;
    registerOptimizationRoutes(app, auth, db, () => {
      if (!routingClients) {
        throw new RoutingError("ROUTING_NOT_CONFIGURED");
      }
      return routingClients;
    });
    app.addHook("onClose", async () => {
      await closeDb(db);
    });
    postgres = { db, auth, fleet, evidence, bus };
  } else {
    const store = new DemoStore("morning-rush");
    const bus = createRealtimeBus(app.server, { demoMode: true });
    registerDemoRoutes(app, store, bus);
    demo = { store, bus };
  }

  return { app, demo, postgres };
}













