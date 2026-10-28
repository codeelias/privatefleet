/**
 * Phase 4 socket gate (docs/09.4): production handshakes require a valid
 * access token, rooms are derived server-side, and telemetry published for
 * one tenant is never delivered to another.
 */
import { createServer, type Server as HttpServer } from "node:http";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRealtimeBus, type RealtimeBus } from "./realtime.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

let server: HttpServer;
let bus: RealtimeBus;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  server = createServer();
  bus = createRealtimeBus(server, {
    demoMode: false,
    verifyToken: async (token) => {
      if (token === "token-a") {
        return { tenantId: TENANT_A, userId: "user-a", role: "dispatcher" };
      }
      if (token === "token-b") {
        return { tenantId: TENANT_B, userId: "user-b", role: "dispatcher" };
      }
      throw new Error("invalid token");
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("no ephemeral port");
  }
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const socket of sockets) {
    socket.close();
  }
  await bus.close();
});

function connectWith(token?: string): Promise<Socket> {
  const socket = connect(url, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: false,
    auth: token ? { token } : {},
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

describe("authenticated telemetry rooms", () => {
  it("delivers telemetry only to sockets of the same tenant", async () => {
    const socketA = await connectWith("token-a");
    const socketB = await connectWith("token-b");
    const received: string[] = [];
    socketA.on("vehicle.position", (position: { vehicleId: string }) =>
      received.push(`a:${position.vehicleId}`),
    );
    socketB.on("vehicle.position", (position: { vehicleId: string }) =>
      received.push(`b:${position.vehicleId}`),
    );

    bus.publishTelemetry(TENANT_A, {
      vehicleId: "33333333-3333-4333-8333-333333333333",
      driverId: "44444444-4444-4444-8444-444444444444",
      latitude: 51.5,
      longitude: -0.12,
      capturedAt: new Date().toISOString(),
      sequenceNo: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toEqual(["a:33333333-3333-4333-8333-333333333333"]);
  });

  it("rejects a connection without a valid access token", async () => {
    await expect(connectWith()).rejects.toThrow();
    await expect(connectWith("not-a-token")).rejects.toThrow();
  });
});
