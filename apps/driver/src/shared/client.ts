/**
 * Driver client (docs/06.4): typed API access, device session handling
 * and the durable offline command queue.
 *
 * Two modes:
 * - demo: profile picker + in-memory demo endpoints (Phase 1).
 * - production (postgres): driver PIN login, bearer tokens with one
 *   transparent refresh, tenant/driver-scoped queue.
 *
 * Commands are persisted with stable idempotency keys. Offline failures
 * stay pending for retry; server rejections become explicit conflicts
 * and are never silently dropped.
 */
import type {
  DriverDto,
  DriverSession,
  FleetState,
  JobDto,
  JobStopDto,
} from "@privatefleet/contracts";
import { io } from "socket.io-client";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface DriverStoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accessTtlMs: number;
  driver: DriverDto;
  tenantSlug: string;
}

const SESSION_KEY = "privatefleet.driver.session.v1";
const QUEUE_KEY = "privatefleet.driver.queue";

function readSession(): DriverStoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as DriverStoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: DriverStoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function storedDriverSession(): DriverStoredSession | null {
  return readSession();
}

export function signOutDriver(): void {
  localStorage.removeItem(SESSION_KEY);
}

let session: DriverStoredSession | null = readSession();
let authLostHandler: (() => void) | null = null;
// Refresh single-flight: concurrent requests must not rotate the same
// refresh token twice (the loser would otherwise destroy the session).
let refreshInFlight: Promise<string | null> | null = null;

export function onAuthLost(handler: () => void): void {
  authLostHandler = handler;
}

function clearAuth(): void {
  session = null;
  signOutDriver();
  authLostHandler?.();
}

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const normalized: RequestInit =
    init && init.method === "POST" && init.body === undefined
      ? { ...init, body: "{}" }
      : init ?? {};
  const res = await fetch(path, {
    ...normalized,
    headers: { "content-type": "application/json", ...normalized.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { uiMessage?: string } | null;
    throw new HttpError(
      res.status,
      body?.uiMessage ?? "That request could not be completed. Try again.",
    );
  }
  return (await res.json()) as T;
}

/** Returns a valid access token; `force` refreshes after a server 401. */
async function accessToken(force = false): Promise<string | null> {
  if (!session) {
    return null;
  }
  const horizon = Math.min(15_000, Math.floor(session.accessTtlMs / 2));
  if (!force && Date.now() < session.expiresAt - horizon) {
    return session.accessToken;
  }
  if (!refreshInFlight) {
    const current = session;
    refreshInFlight = (async () => {
      try {
        const tokens = await rawRequest<{
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
          tokenType: "Bearer";
        }>("/v1/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        session = {
          ...current,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          accessTtlMs: tokens.expiresIn * 1000,
        };
        writeSession(session);
        return session.accessToken;
      } catch {
        clearAuth();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit, useAuth = true): Promise<T> {
  const token = useAuth ? await accessToken() : null;
  const send = async (bearer: string | null): Promise<Response> => {
    const normalized: RequestInit =
      init && init.method === "POST" && init.body === undefined
        ? { ...init, body: "{}" }
        : init ?? {};
    return fetch(path, {
      ...normalized,
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...normalized.headers,
      },
    });
  };
  let res = await send(token);
  if (res.status === 401 && useAuth) {
    // A 401 means the server rejected the token even if the client clock
    // thought it valid: refresh unconditionally, then retry once.
    const retried = await accessToken(true);
    if (retried) {
      res = await send(retried);
    }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { uiMessage?: string } | null;
    if (res.status === 401) {
      clearAuth();
    }
    throw new HttpError(
      res.status,
      body?.uiMessage ?? "That request could not be completed. Try again.",
    );
  }
  return (await res.json()) as T;
}

export interface DriverQueue {
  driver: DriverDto;
  jobs: JobDto[];
}

export const api = {
  meta: () => rawRequest<{ demoMode: boolean; repositoryMode: string }>("/v1/meta"),
  driverLogin: async (input: {
    tenantSlug: string;
    driverId: string;
    pin: string;
  }): Promise<DriverStoredSession> => {
    const response = await rawRequest<DriverSession>("/v1/auth/driver-login", {
      method: "POST",
      body: JSON.stringify(input),
    });
    session = {
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      expiresAt: Date.now() + response.tokens.expiresIn * 1000,
      accessTtlMs: response.tokens.expiresIn * 1000,
      driver: response.driver,
      tenantSlug: input.tenantSlug,
    };
    writeSession(session);
    return session;
  },
  driverQueue: () => request<DriverQueue>("/v1/driver/queue"),
  driverStartShift: () => request<DriverDto>("/v1/driver/shift/start", { method: "POST" }),
  fleetState: () => request<FleetState>("/v1/fleet/state"),
  startShift: (driverId: string) =>
    request<DriverDto>("/v1/driver/shift/start", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  queue: (driverId: string) => request<DriverQueue>(`/v1/driver/${driverId}/queue`),
  arrive: (jobId: string, stopId: string, driverId: string, commandId: string) =>
    request(`/v1/jobs/${jobId}/stops/${stopId}/arrive`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId }),
    }),
  complete: (
    jobId: string,
    stopId: string,
    driverId: string,
    payload: { recipientName?: string | undefined; notes?: string | undefined },
    commandId: string,
  ) =>
    request(`/v1/jobs/${jobId}/stops/${stopId}/complete`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId, ...payload }),
    }),
  skip: (jobId: string, stopId: string, driverId: string, reason: string, commandId: string) =>
    request(`/v1/jobs/${jobId}/stops/${stopId}/skip`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId, reason }),
    }),
};

export function createFleetSocket() {
  return io({ path: "/socket.io" });
}

export interface QueuedCommand {
  commandId: string;
  kind: "arrive" | "complete" | "skip";
  jobId: string;
  stopId: string;
  driverId: string;
  payload?: { recipientName?: string; notes?: string; reason?: string } | undefined;
  capturedAt: string;
  status: "pending" | "accepted" | "conflict";
}

export function loadQueue(): QueuedCommand[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedCommand[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedCommand[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function pendingCount(): number {
  return loadQueue().filter((command) => command.status === "pending").length;
}

export function conflictCount(): number {
  return loadQueue().filter((command) => command.status === "conflict").length;
}

/** Persist a command, then try to sync it. Offline keeps it pending. */
export async function enqueue(
  command: Omit<QueuedCommand, "status">,
): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  const queue = loadQueue();
  queue.push({ ...command, status: "pending" });
  saveQueue(queue);
  return flush();
}

/**
 * Submit pending commands in order. A 4xx is an explicit conflict (the
 * server refused it, e.g. already completed); network/5xx keep the
 * command pending for the next retry. Never silently overwrites.
 */
let flushInFlight: Promise<{ ok: boolean; message?: string; conflict?: boolean }> | null = null;

export async function flush(): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  // One flush at a time: concurrent online events must not dispatch the
  // same pending command twice with different ordering.
  if (flushInFlight) {
    return flushInFlight;
  }
  flushInFlight = flushOnce().finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function flushOnce(): Promise<{ ok: boolean; message?: string; conflict?: boolean }> {
  const queue = loadQueue();
  let accepted = false;
  for (const command of queue) {
    if (command.status !== "pending") {
      continue;
    }
    try {
      await dispatch(command);
      command.status = "accepted";
      accepted = true;
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        command.status = "conflict";
        saveQueue(queue);
        return { ok: false, conflict: true, message: err.message };
      }
      saveQueue(queue);
      return {
        ok: false,
        message: "Offline - your action is saved and will sync automatically.",
      };
    }
  }
  saveQueue(queue.filter((command) => command.status !== "accepted"));
  return accepted ? { ok: true } : { ok: true };
}

async function dispatch(command: QueuedCommand): Promise<void> {
  if (command.kind === "arrive") {
    await api.arrive(command.jobId, command.stopId, command.driverId, command.commandId);
  } else if (command.kind === "complete") {
    await api.complete(
      command.jobId,
      command.stopId,
      command.driverId,
      { recipientName: command.payload?.recipientName, notes: command.payload?.notes },
      command.commandId,
    );
  } else {
    await api.skip(
      command.jobId,
      command.stopId,
      command.driverId,
      command.payload?.reason ?? "No reason given",
      command.commandId,
    );
  }
}

export function nextStops(queue: DriverQueue): { job: JobDto; stop: JobStopDto }[] {
  return queue.jobs.flatMap((job) =>
    job.stops
      .filter((s) => s.status === "pending" || s.status === "arrived")
      .map((stop) => ({ job, stop })),
  );
}








