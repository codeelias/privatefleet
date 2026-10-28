/**
 * Socket.IO bus (docs/09.4): tenant rooms are derived server-side from an
 * authenticated handshake. Demo mode keeps its seeded tenant room with no
 * token (ADR-0007). Business events use the outbox path; telemetry is
 * direct, with optional per-vehicle coalescing for dispatcher UIs.
 */
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { EventEnvelope, VehiclePosition } from "@privatefleet/contracts";
import { DEMO_TENANT_ID } from "../modules/demo/data.js";

export interface RealtimePrincipal {
  tenantId: string;
  userId: string;
  role: string;
}

export interface RealtimeBus {
  publishBusiness(event: EventEnvelope): void;
  /** Telemetry is tenant-scoped: it can never leak to another room. */
  publishTelemetry(tenantId: string, position: VehiclePosition): void;
  /** Closes the Socket.IO server (used on shutdown and in tests). */
  close(): Promise<void>;
}

export interface RealtimeBusOptions {
  demoMode: boolean;
  /** Access-token verifier for production handshakes. */
  verifyToken?: (token: string) => Promise<RealtimePrincipal>;
  /** 0 emits immediately; >0 keeps only the newest sample per window. */
  coalesceMs?: number;
}

interface PendingTelemetry {
  position: VehiclePosition;
  timer: ReturnType<typeof setTimeout>;
}

export function createRealtimeBus(
  httpServer: HttpServer,
  options: RealtimeBusOptions,
): RealtimeBus {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: "*" },
  });

  io.use((socket, next) => {
    if (options.demoMode) {
      socket.data.tenantId = DEMO_TENANT_ID;
      next();
      return;
    }
    const raw =
      (socket.handshake.auth as { token?: unknown } | undefined)?.token ??
      socket.handshake.headers.authorization;
    const token =
      typeof raw === "string" ? raw.replace(/^Bearer\s+/i, "") : "";
    if (!token || !options.verifyToken) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    options
      .verifyToken(token)
      .then((principal) => {
        socket.data.tenantId = principal.tenantId;
        next();
      })
      .catch(() => next(new Error("UNAUTHORIZED")));
  });

  io.on("connection", (socket) => {
    const tenantId = socket.data.tenantId as string | undefined;
    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
    }
  });

  const emitTelemetry = (tenantId: string, position: VehiclePosition): void => {
    io.to(`tenant:${tenantId}`).emit("vehicle.position", position);
  };
  const coalesceMs = options.coalesceMs ?? 0;
  const pending = new Map<string, PendingTelemetry>();

  return {
    publishBusiness(event) {
      io.to(`tenant:${event.tenantId}`).emit("event", event);
    },
    async close() {
      await io.close();
    },
    publishTelemetry(tenantId, position) {
      if (coalesceMs <= 0) {
        emitTelemetry(tenantId, position);
        return;
      }
      const key = `${tenantId}:${position.vehicleId}`;
      const queued = pending.get(key);
      if (queued) {
        queued.position = position;
        return;
      }
      const entry: PendingTelemetry = {
        position,
        timer: setTimeout(() => {
          pending.delete(key);
          emitTelemetry(tenantId, entry.position);
        }, coalesceMs),
      };
      pending.set(key, entry);
    },
  };
}


