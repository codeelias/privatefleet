/**
 * Expo driver API client: device PIN session, refresh and queue access
 * against the real API. API base is EXPO_PUBLIC_API_URL (Expo inlines
 * EXPO_PUBLIC_* at build time).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

// Web builds are served behind Caddy on the same origin; native builds
// must provide the LAN API URL at build time.
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "web" ? "" : "https://api.privatefleet.home.arpa");
const SESSION_KEY = "privatefleet.expo.session.v1";

export interface DriverDto {
  id: string;
  fullName: string;
  status: string;
  vehicleId?: string;
}

export interface JobStop {
  id: string;
  jobId: string;
  sequenceNo: number;
  stopType: "pickup" | "dropoff";
  address: string;
  location: { latitude: number; longitude: number };
  status: "pending" | "arrived" | "completed" | "skipped" | "failed";
  windowStart?: string;
}

export interface JobDto {
  id: string;
  reference: string;
  serviceType: string;
  priority: string;
  status: string;
  stops: JobStop[];
}

export interface DriverQueue {
  driver: DriverDto;
  jobs: JobDto[];
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accessTtlMs: number;
  driver: DriverDto;
  tenantSlug: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let session: StoredSession | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    session = raw ? (JSON.parse(raw) as StoredSession) : null;
    return session;
  } catch {
    return null;
  }
}

async function saveSession(next: StoredSession): Promise<void> {
  session = next;
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
}

export async function clearSession(): Promise<void> {
  session = null;
  await AsyncStorage.removeItem(SESSION_KEY);
}

async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  }).catch((err) => {
    console.error("[pf-api] raw fetch failed:", String(err));
    throw new HttpError(0, `Network request failed: ${String(err)}`);
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { uiMessage?: string } | null;
    console.error("[pf-api] raw status", res.status, JSON.stringify(body));
    throw new HttpError(
      res.status,
      body?.uiMessage ?? "That request could not be completed. Try again.",
    );
  }
  return (await res.json()) as T;
}

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
        }>("/v1/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        const next: StoredSession = {
          ...current,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
          accessTtlMs: tokens.expiresIn * 1000,
        };
        await saveSession(next);
        return next.accessToken;
      } catch {
        await clearSession();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const send = async (bearer: string | null): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body !== undefined && init.body !== null
          ? { "content-type": "application/json" }
          : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  let res = await send(token).catch((err) => {
    console.error("[pf-api] fetch failed:", String(err));
    throw new HttpError(0, `Network request failed: ${String(err)}`);
  });
  if (res.status === 401) {
    const retried = await accessToken(true);
    if (retried) {
      res = await send(retried);
    }
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { uiMessage?: string } | null;
    throw new HttpError(
      res.status,
      body?.uiMessage ?? "That request could not be completed. Try again.",
    );
  }
  return (await res.json()) as T;
}

export async function driverLogin(input: {
  tenantSlug: string;
  driverId: string;
  pin: string;
}): Promise<StoredSession> {
  const response = await rawRequest<{
    driver: DriverDto;
    tokens: { accessToken: string; refreshToken: string; expiresIn: number };
  }>("/v1/auth/driver-login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const next: StoredSession = {
    accessToken: response.tokens.accessToken,
    refreshToken: response.tokens.refreshToken,
    expiresAt: Date.now() + response.tokens.expiresIn * 1000,
    accessTtlMs: response.tokens.expiresIn * 1000,
    driver: response.driver,
    tenantSlug: input.tenantSlug,
  };
  await saveSession(next);
  return next;
}

export interface EvidenceUpload {
  kind: "signature" | "photo" | "failure_photo";
  dataBase64?: string;
  pathData?: string;
  capturedAt?: string;
}

export const api = {
  uploadEvidence: (jobId: string, stopId: string, input: EvidenceUpload) =>
    request(`/v1/jobs/${jobId}/stops/${stopId}/evidence`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  driverQueue: () => request<DriverQueue>("/v1/driver/queue"),
  startShift: () => request<DriverDto>("/v1/driver/shift/start", { method: "POST" }),
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
    recipientName: string,
    commandId: string,
  ) =>
    request(`/v1/jobs/${jobId}/stops/${stopId}/complete`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId, recipientName }),
    }),
  skip: (
    jobId: string,
    stopId: string,
    driverId: string,
    reasonCode: string,
    note: string | undefined,
    commandId: string,
  ) =>
    request(`/v1/jobs/${jobId}/stops/${stopId}/skip`, {
      method: "POST",
      headers: { "idempotency-key": commandId },
      body: JSON.stringify({ driverId, reasonCode, note }),
    }),
};




