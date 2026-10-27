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
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
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
};
