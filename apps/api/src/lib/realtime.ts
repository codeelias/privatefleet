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
  const room = `tenant:${DEMO_TENANT_ID}`;
  return {
    publishBusiness(event) {
      io.to(room).emit("event", event);
    },
    publishTelemetry(position) {
      io.to(room).emit("vehicle.position", position);
    },
  };
}
