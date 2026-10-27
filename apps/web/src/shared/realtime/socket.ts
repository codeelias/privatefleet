/**
 * Socket.IO client (docs/09.4): business events and telemetry arrive
 * here; recovery is by snapshot fetch (React Query refetch), per the
 * golden rules - sockets deliver, the database stores.
 */
import { io, type Socket } from "socket.io-client";

export function createFleetSocket(): Socket {
  return io({ path: "/socket.io" });
}
