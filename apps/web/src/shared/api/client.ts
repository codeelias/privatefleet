/**
 * Typed API client (docs/05.4): the only adapter the web app uses.
 * Presentation components never call fetch directly; errors surface
 * the conversational uiMessage from ADR-0011.
 */
import type {
  AssignResponse,
  AssignmentPreview,
  FleetState,
  OptimizationProposal,
  ScenarioName,
  ScenariosList,
} from "@privatefleet/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Fastify rejects a POST with a JSON content type and an empty body
  // (FST_ERR_CTP_EMPTY_JSON_BODY); normalize bodyless commands to "{}".
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
    throw new Error(body?.uiMessage ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: () => request<{ name: string; version: string; demoMode: boolean }>("/v1/meta"),
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
  approvePlan: (runId: string) =>
    request<OptimizationProposal>(`/v1/optimization/${runId}/approve`, {
      method: "POST",
    }),
  acknowledgeAlert: (alertId: string) =>
    request(`/v1/alerts/${alertId}/acknowledge`, { method: "POST" }),
  resolveAlert: (alertId: string) =>
    request(`/v1/alerts/${alertId}/resolve`, { method: "POST" }),
};
