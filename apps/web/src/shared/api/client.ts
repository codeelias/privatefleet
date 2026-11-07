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
  AnalyticsReport,
  AssignResponse,
  AssignmentPreview,
  AuthSession,
  AuthTokens,
  FleetState,
  FleetRoutesResponse,
  EvidenceList,
  DeliveryPerformanceReport,
  TrackingTokenCreate,
  JobImportCommitResponse,
  JobImportPreview,
  FleetOptimizationProposal,
  GeofenceDto,
  GeofenceList,
  LiveOptimizationProposal,
  OptimizationProposal,
  ReplanResponse,
  ScenarioName,
  ScenariosList,
} from "@privatefleet/contracts";

export interface NotificationRow {
  id: string;
  jobId: string;
  eventType: string;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  detail?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

export class AuthExpiredError extends Error {
  constructor() {
    super("Your session has expired. Please sign in again.");
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
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
  const body = (await res.json().catch(() => null)) as {
    uiMessage?: string;
    code?: string;
  } | null;
  return new HttpError(
    res.status,
    body?.code,
    body?.uiMessage ?? "That request could not be completed. Try again.",
  );
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

async function requestText(path: string): Promise<string> {
  const send = async (token: string | null): Promise<Response> =>
    fetch(path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
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
  return res.text();
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

export interface DispatchPolicyView {
  revision: number;
  preset: "local" | "balanced" | "extended";
  maxDistanceM: number;
  maxTravelTimeS: number;
  maxWorkingDurationS: number;
  maxVisits: number;
  overrides: Array<{
    vehicleId: string;
    maxDistanceM?: number;
    maxTravelTimeS?: number;
    maxWorkingDurationS?: number;
    maxVisits?: number;
  }>;
  enabled: boolean;
}

export interface AssignmentRecommendation {
  jobId: string;
  reference: string;
  priority: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  registration: string;
  detourKm: number;
  addedMinutes: number;
  addedCostPence: number;
  currentRouteCostPence: number;
  reason: string;
}

export interface RecommendationResponse {
  generatedAt: string;
  economics: {
    fuelPencePerKm: number;
    vehiclePencePerKm: number;
    driverPencePerHour: number;
    maxDetourKm: number;
  };
  routes: Array<{
    driverId: string;
    driverName: string;
    registration: string;
    distanceMetres: number;
    durationSeconds: number;
    estimatedCostPence: number;
  }>;
  recommendations: AssignmentRecommendation[];
}
export interface WorkRequestView {
  id: string;
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  registration: string | null;
  status: string;
  requestedAt: string;
  routeVersion: number | null;
  policyRevision: number | null;
  note: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  lastGpsAt: string | null;
  gpsAgeSeconds: number | null;
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
  fleetState: (includeRoutes = true) =>
    request<FleetState>(
      includeRoutes ? "/v1/fleet/state" : "/v1/fleet/state?includeRoutes=false",
    ),
  fleetRoutes: () => request<FleetRoutesResponse>("/v1/fleet/routes"),
  stopEvidence: (jobId: string, stopId: string) =>
    request<EvidenceList>(`/v1/jobs/${jobId}/stops/${stopId}/evidence`),
  deliveryPerformance: (query = "") =>
    request<DeliveryPerformanceReport>(`/v1/reports/delivery-performance${query}`),
  deliveryPerformanceCsv: (query = "") =>
    requestText(`/v1/reports/delivery-performance${query ? `${query}&format=csv` : "?format=csv"}`),
  listGeofences: () => request<GeofenceList>("/v1/geofences"),
  createGeofence: (name: string, geojson: string, enabled = true, jobId?: string, driverIds?: string[]) =>
    request<GeofenceDto>("/v1/geofences", {
      method: "POST",
      body: JSON.stringify({ name, geojson, enabled, ...(jobId ? { jobId } : {}), ...(driverIds ? { driverIds } : {}) }),
    }),
  updateGeofence: (id: string, patch: { name?: string; enabled?: boolean; geojson?: string; driverIds?: string[] }) =>
    request<GeofenceDto>("/v1/geofences/" + id, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteGeofence: (id: string) =>
    request<{ deleted: boolean }>("/v1/geofences/" + id, { method: "DELETE" }),
  createTrackingToken: (jobId: string, notify?: { recipientEmail: string }) =>
    request<TrackingTokenCreate>("/v1/tracking-tokens", {
      method: "POST",
      body: JSON.stringify({
        jobId,
        ...(notify ? { notifyEnabled: true, recipientEmail: notify.recipientEmail } : {}),
      }),
    }),
  notifications: () =>
    request<{ notifications: NotificationRow[] }>("/v1/notifications"),
  analytics: (query = "") =>
    request<AnalyticsReport>(`/v1/reports/analytics${query}`),
  revokeTrackingToken: (tokenId: string) =>
    request<{ revoked: boolean }>(`/v1/tracking-tokens/${tokenId}`, {
      method: "DELETE",
    }),
  importPreview: (csv: string) =>
    request<JobImportPreview>("/v1/jobs/import", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
  importCommit: (jobs: JobImportPreview["jobs"]) =>
    request<JobImportCommitResponse>("/v1/jobs/import/commit", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ jobs }),
    }),
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
  getDispatchPolicy: () => request<DispatchPolicyView>("/v1/dispatch-policy"),
  updateDispatchPolicy: (input: {
    expectedRevision: number;
    preset?: "local" | "balanced" | "extended";
    maxDistanceM?: number;
    maxTravelTimeS?: number;
    maxWorkingDurationS?: number;
    maxVisits?: number;
    overrides?: Array<{
      vehicleId: string;
      maxDistanceM?: number;
      maxTravelTimeS?: number;
      maxWorkingDurationS?: number;
      maxVisits?: number;
    }>;
  }) =>
    request<DispatchPolicyView>("/v1/dispatch-policy", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  getWorkRequests: () => request<WorkRequestView[]>("/v1/dispatch/work-requests"),
  decideWorkRequest: (id: string, decision: "approved" | "declined", note?: string) =>
    request<WorkRequestView>(`/v1/dispatch/work-requests/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
    }),
  getRecommendations: () => request<RecommendationResponse>("/v1/dispatch/recommendations"),
  closeFleetRoute: (vehicleId: string, version: number) =>
    request<{ routeId: string; freedJobs: number; status: string }>(
      "/v1/fleet/routes/close",
      {
        method: "POST",
        body: JSON.stringify({ vehicleId, version }),
      },
    ),
  runFleetOptimization: () =>
    request<FleetOptimizationProposal>("/v1/optimization/fleet-run", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  approveFleetPlan: (runId: string, expectedRouteVersion: number) =>
    request<{ version: number; routeIds: string[]; publishedAt: string }>(
      `/v1/optimization/fleet/${runId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ expectedRouteVersion }),
      },
    ),
  runOptimizationLive: (driverId: string) =>
    request<LiveOptimizationProposal>("/v1/optimization/run", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  runOptimization: (driverId: string) =>
    request<OptimizationProposal>("/v1/optimization/run", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  replan: (driverId: string) =>
    request<ReplanResponse>("/v1/optimization/replan", {
      method: "POST",
      body: JSON.stringify({ driverId }),
    }),
  approveLivePlan: (runId: string, expectedRouteVersion: number) =>
    request<{ routeId: string; version: number; publishedAt: string }>(
      `/v1/optimization/${runId}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ expectedRouteVersion }),
      },
    ),
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













