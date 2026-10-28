import { expect, test } from "@playwright/test";
import { fleetState, resetScenario, WEB } from "./helpers";

/**
 * Map quality acceptance (docs/17): truthful stale state, reconnect
 * snapshot recovery, and retention of the last verified route when a
 * routing update is malformed. Dispatcher layout only.
 */

test("stale GPS ghosts markers and never shows them as live", async ({ page, isMobile }) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();

  // Let telemetry establish accepted samples, then cut the network.
  await page.waitForTimeout(3_500);
  await page.context().setOffline(true);
  await page.waitForTimeout(11_000);

  // Ghosted markers expose "last known" and the stale visual class.
  const ghosts = page.locator('[title*="last known"]');
  await expect.poll(async () => ghosts.count(), { timeout: 10_000 }).toBeGreaterThan(0);
  const staleGhosts = page.locator(".stale-ghost");
  expect(await staleGhosts.count()).toBeGreaterThan(0);

  await page.context().setOffline(false);
});

test("reconnect restores a consistent snapshot without duplicates", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();
  const before = await fleetState();

  await page.context().setOffline(true);
  await page.waitForTimeout(2_000);
  await page.context().setOffline(false);

  // A fresh snapshot (full reload) must restore the same authoritative state.
  await page.reload();
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(3);

  const after = await fleetState();
  expect(after.jobs.map((job) => job.id).sort()).toEqual(before.jobs.map((job) => job.id).sort());
  expect(after.routes.length).toBe(3);
  expect(after.vehicles.length).toBe(before.vehicles.length);
  // No duplicated timeline rows: one tray per job reference.
  const references = after.jobs.map((job) => job.reference);
  expect(new Set(references).size).toBe(references.length);
});

test("debug alignment grid is available behind ?debug=map", async ({ page, isMobile }) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");
  await page.goto(`${WEB}/?debug=map`);
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();
  const grid = page.getByTestId("map-debug-grid");
  await expect(grid).toBeVisible();
  await expect
    .poll(async () =>
      grid.evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        return canvas.width > 0 && canvas.height > 0;
      }),
    )
    .toBe(true);
});

test("malformed route geometry is hidden and the last verified route retained", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(3);

  // Force the next fleet snapshot to carry invalid geometry for every route.
  const base = await fleetState();
  const malformed = {
    ...base,
    routes: base.routes.map((route) => ({ ...route, points: [] })),
  };
  await page.route("**/v1/fleet/state", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(malformed) }),
  );

  // Trigger a refetch through the UI (scenario switch invalidates the query).
  await page.getByRole("button", { name: "Emergency" }).click();
  await expect(page.getByTestId("route-quality-warning")).toContainText(
    /last verified route/,
  );
  // The previously verified routes stay drawn; nothing fabricated appears.
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(3);

  await page.unroute("**/v1/fleet/state");
});


