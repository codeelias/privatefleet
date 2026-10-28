import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { fleetState, resetScenario, WEB } from "./helpers";

async function openDispatcher(page: Page): Promise<void> {
  await page.goto(WEB);
  await expect(page.getByText("Fleet Operations")).toBeVisible();
}

/**
 * Map regression guard: vehicle positions must follow the simulated
 * route (the state once reported the route's first point forever) and
 * route polylines must render from FleetState.routes.
 */
test("Live map: vehicles follow routes and pins move", async ({ page }) => {
  await resetScenario("morning-rush");

  const first = await fleetState();
  await page.waitForTimeout(4_000);
  const second = await fleetState();

  expect(first.routes.length).toBeGreaterThanOrEqual(3);
  expect(first.routes[0]?.points.length).toBeGreaterThanOrEqual(2);
  const a = first.vehicles[0]?.location;
  const b = second.vehicles[0]?.location;
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(`${a?.latitude},${a?.longitude}`).not.toBe(`${b?.latitude},${b?.longitude}`);

  await openDispatcher(page);
  const polylines = await page.locator("path.leaflet-interactive").count();
  expect(polylines).toBeGreaterThanOrEqual(2);

  const pin = page.locator('[title*="VAN-02"]').first();
  await expect(pin).toBeVisible();
  const before = await pin.evaluate((el) => (el as HTMLElement).style.left);
  await page.waitForTimeout(4_500);
  const after = await pin.evaluate((el) => (el as HTMLElement).style.left);
  expect(after).not.toBe(before);
});

