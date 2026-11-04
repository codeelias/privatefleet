/**
 * Socket.IO client (docs/09.4): business events and telemetry arrive
 * here; recovery is by snapshot fetch (React Query refetch), per the
 * golden rules - sockets deliver, the database stores.
 */
import { io, type Socket } from "socket.io-client";

let tokenProvider: (() => Promise<string | null>) | null = null;

/** Wired by the session hook; demo mode leaves it null (no token). */
export function configureSocketAuth(provider: (() => Promise<string | null>) | null): void {
  tokenProvider = provider;
}

export function createFleetSocket(): Socket {
  return io({
    path: "/socket.io",
    // Deterministic recovery: 10 attempts with exponential backoff, then the
    // snapshot refetch (React Query) is the fallback per docs/09.4.
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    randomizationFactor: 0.5,
    auth: (callback: (data: object) => void) => {
      const provider = tokenProvider;
      if (!provider) {
        callback({});
        return;
      }
      void provider()
        .then((token) => callback(token ? { token } : {}))
        .catch(() => callback({}));
    },
  });
}

