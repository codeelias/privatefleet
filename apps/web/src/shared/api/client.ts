/**
 * Typed API client (docs/05.4): the only adapter the web app uses.
 * Presentation components never call fetch directly; errors surface
 * the conversational uiMessage from ADR-0011.
 *
 * Phase 2 auth: requests carry the access token. A 401 triggers one
 * contract-compliant refresh (rotation) and a retry; when the refresh
 * itself fails the session is cleared and the app returns to login.
 */
import type {
  AssignResponse,
  AssignmentPreview,
  AuthSession,
  AuthTokens,
  FleetState,
  OptimizationProposal,
  ScenarioName,
  ScenariosList,
} from "@privatefleet/contracts";

export class AuthExpiredError extends Error {
  constructor() {
    super("Your session has expired. Please sign in again.");
  }
}

interface AuthHooks {
  getAccessToken: () => Promise<string | null>;
  onRefreshFailed: () => void;
}

let authHooks: AuthHooks | null = null;

export function configureAuth(hooks: AuthHooks | null): void {
  authHooks = hooks;
}

async function parseError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { uiMessage?: string } | null;
  return new Error(body?.uiMessage ?? "That request could not be completed. Try again.");
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
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const send = async (token: string | null): Promise<Response> => {
    const normalized: RequestInit =
      init && init.method === "POST" && init.body === undefined
        ? { ...init, body: "{}" }
        : init ?? {};
    return fetch(path, {
      ...normalized,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...normalized.headers,
      },
    });
  };

  const token = authHooks ? await authHooks.getAccessToken() : null;
  let res = await send(token);
  if (res.status === 401 && authHooks) {
    try {
      const refreshed = await authHooks.getAccessToken();
      if (!refreshed) {
        throw new AuthExpiredError();
      }
      res = await send(refreshed);
    } catch {
      authHooks.onRefreshFailed();
      throw new AuthExpiredError();
    }
  }
  if (!res.ok) {
    throw await parseError(res);
  }
  return (await res.json()) as T;
}

function toSession(
  response: AuthSession,
  tokens: AuthTokens,
): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accessTtlMs: number;
  tenant: AuthSession["tenant"];
  user: AuthSession["user"];
} {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    accessTtlMs: tokens.expiresIn * 1000,
    tenant: response.tenant,
    user: response.user,
  };
}

export const api = {
  meta: () =>
    rawRequest<{ name: string; version: string; demoMode: boolean; repositoryMode: string }>(
      "/v1/meta",
    ),
  login: (input: { tenantSlug: string; email: string; password: string }) =>
    rawRequest<AuthSession>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  refresh: (refreshToken: string) =>
    rawRequest<AuthTokens>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  logout: (refreshToken: string) =>
    rawRequest<{ loggedOut: boolean }>("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  fleetState: () => request<FleetState>("/v1/fleet/state"),
  scenarios: () => request<ScenariosList>("/v1/demo/scenarios"),
  resetScenario: (id: ScenarioName) =>
    request<ScenariosList>(`/v1/demo/scenarios/${id}/reset`, { method: "POST" }),
  previewAssignment: (jobId: string, driverId: string) =>
    request<AssignmentPreview>(`/v1/jobs/${jobId}/assignment-preview`, {
      method: "POST",
      body: JSON.stringify({ jobId, driverId }),
    }),
  assignJob: (jobId: string, driverId: string, idempotencyKey: string) =>
    request<AssignResponse>(`/v1/jobs/${jobId}/assign`, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify({ jobId, driverId }),
    }),
  runOptimization: (driverId: string) =>
    request<OptimizationProposal>("/v1/optimization/run", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  approvePlan: (runId: string, expectedRouteVersion: number) =>
    request<OptimizationProposal>(`/v1/optimization/${runId}/approve`, {
      method: "POST",
      body: JSON.stringify({ expectedRouteVersion }),
    }),
  acknowledgeAlert: (alertId: string) =>
    request(`/v1/alerts/${alertId}/acknowledge`, { method: "POST" }),
  resolveAlert: (alertId: string) =>
    request(`/v1/alerts/${alertId}/resolve`, { method: "POST" }),
  sessionFrom: toSession,
};


