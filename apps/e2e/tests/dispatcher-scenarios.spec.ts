/**
 * Dispatcher-side demo scenarios (docs/12.2): Morning Rush and the
 * Emergency drag-and-drop, both with the impact preview and the
 * server-authoritative assignment confirmation.
 */
import { expect, test, type Page } from "@playwright/test";
import { API, WEB, fleetState, resetScenario } from "./helpers";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop dispatcher project only");

async function openDispatcher(page: Page): Promise<void> {
  await page.goto(WEB);
  await expect(page.getByText("Fleet Operations")).toBeVisible();
}

test("Morning Rush: assign J-208 via click flow with impact preview", async ({ page }) => {
  await resetScenario("morning-rush");
  await openDispatcher(page);

  // Regression guard: the scenario buttons themselves must work through
  // the UI (bodyless POST commands once 500'd - docs rehearsal review).
  await page.getByRole("button", { name: "Proof of Service" }).click();
  await expect(page.getByRole("button", { name: "Proof of Service" })).toBeEnabled();
  await page.getByRole("button", { name: "Morning Rush" }).click();
  await expect(page.getByRole("button", { name: "Morning Rush" })).toBeEnabled();

  const trayHeader = page.getByText("Unassigned jobs - drag onto a driver or select");
  await expect(trayHeader).toBeVisible();

  const card = page.getByRole("button", { name: /J-208/ }).first();
  await card.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Sarah Reed/ }).click();
  await expect(dialog.getByText(/adds \d+ min to their next stop/)).toBeVisible();

  const started = Date.now();
  await dialog.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(dialog).toBeHidden();
  // Committed visual update: the job leaves the unassigned tray.
  await expect(page.getByRole("button", { name: /J-208/ })).toBeHidden();
  const elapsed = Date.now() - started;

  // docs/05.8 budget is 500ms on demo hardware; CI gets a wide margin
  // and the rehearsal on the demo tablet enforces the real number.
  expect(elapsed).toBeLessThan(2_000);

  const state = await fleetState();
  const job = state.jobs.find((j) => j.reference === "J-208");
  expect(job?.assignedDriverId).toBeTruthy();
  expect(job?.status).toBe("assigned");
});

test("Emergency: drag STAT J-208 onto the nearest driver pin", async ({ page }) => {
  await resetScenario("emergency");
  await openDispatcher(page);

  // The urgent STAT alert is visible in the needs-attention panel.
  await expect(page.getByText("J-208 STAT request received")).toBeVisible();

  const handle = page.locator('[aria-label="Drag J-208 to assign"]');
  const pin = page.locator('[title*="Mo Khan"]').first();

  const handleBox = await handle.boundingBox();
  const pinBox = await pin.boundingBox();
  if (!handleBox || !pinBox) {
    throw new Error("Drag source or target not measurable");
  }

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  // Drop opens the assignment modal with the driver preselected.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/adds \d+ min to their next stop/)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(dialog).toBeHidden();

  const state = await fleetState();
  const job = state.jobs.find((j) => j.reference === "J-208");
  expect(job?.assignedDriverId).toBeTruthy();

  // Sanity: the reassign/optimise endpoints still answer after the flow.
  const res = await fetch(`${API}/v1/demo/scenarios`);
  expect(res.ok).toBeTruthy();
});
