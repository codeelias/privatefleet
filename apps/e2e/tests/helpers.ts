/**
 * Shared helpers: typed, server-authoritative fixtures for the E2E
 * scenarios (docs/12.2). State changes are asserted at the API level
 * as well as through the UI.
 */
import { expect, type Page } from "@playwright/test";
import type { FleetState, ScenarioName } from "@privatefleet/contracts";

export const API = "http://127.0.0.1:4000";
export const WEB = "http://127.0.0.1:5173";
export const DRIVER = "http://127.0.0.1:5174";

export async function resetScenario(name: ScenarioName): Promise<void> {
  const res = await fetch(`${API}/v1/demo/scenarios/${name}/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(`Scenario reset failed: ${res.status}`);
  }
}

export async function fleetState(): Promise<FleetState> {
  const res = await fetch(`${API}/v1/fleet/state`);
  return (await res.json()) as FleetState;
}

export async function openUnassigned(page: Page): Promise<void> {
  const open = page.getByRole("button", { name: "Open unassigned jobs" });
  await expect(open).toBeVisible({ timeout: 15_000 });
  await open.click();
  await expect(page.getByRole("button", { name: "Close unassigned jobs" })).toBeVisible();
}
