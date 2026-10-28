/**
 * Socket.IO bus (docs/09.4): server-side room derivation from the demo
 * tenant; business events via the drained outbox, telemetry direct.
 */
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { EventEnvelope, VehiclePosition } from "@privatefleet/contracts";
import { DEMO_TENANT_ID } from "../modules/demo/data.js";

export interface RealtimeBus {
  publishBusiness(event: EventEnvelope): void;
  publishTelemetry(position: VehiclePosition): void;
}

export function createRealtimeBus(httpServer: HttpServer): RealtimeBus {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: "*" },
  });
  io.on("connection", (socket) => {
    socket.join(`tenant:${DEMO_TENANT_ID}`);
  });
  return {
    publishBusiness(event) {
      // Phase 2: events carry their own tenant; publish to that room and
      // keep the demo room for the seeded demo tenant (Phase 1 clients).
      io.to(`tenant:${event.tenantId}`).emit("event", event);
      if (event.tenantId !== DEMO_TENANT_ID) {
        io.to(`tenant:${DEMO_TENANT_ID}`).emit("event", event);
      }
    },
    publishTelemetry(position) {
      io.to(`tenant:${DEMO_TENANT_ID}`).emit("vehicle.position", position);
    },
  };
}
