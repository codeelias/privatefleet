/**
 * Map positioning + camera acceptance (Stages 3-4). The demo fixture is
 * raster so headless Chromium can run without WebGL; bearing is therefore
 * intentionally unavailable and the control must say so rather than fake it.
 */
import { expect, test } from "@playwright/test";
import { WEB, resetScenario } from "./helpers";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop map workspace only");

test("Live map: follow, overview, confidence and navigation surface", async ({ page }) => {
  await resetScenario("morning-rush");
  await page.goto(`${WEB}/?map=raster`);
  await expect(page.getByTestId("map-camera-controls")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("map-navigation")).toBeVisible();

  // Proactive heads-up before the dispatcher opens exceptions.
  const headsUp = page.getByTestId("heads-up");
  await expect(headsUp).toBeVisible();
  await headsUp.getByRole("button").first().click();
  const headsUpPanel = page.getByRole("region", { name: "Predicted operational exceptions" });
  await expect(headsUpPanel).toBeVisible();
  await expect(headsUpPanel).toContainText(/predicted|window|route|GPS|No predicted/i);
  await headsUp.getByRole("button").first().click();
  await expect(headsUpPanel).toBeHidden();

  const camera = page.getByTestId("map-camera-controls");
  const follow = camera.getByRole("button", { name: "Follow", exact: true });
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect(page.getByTestId("map-confidence")).toBeVisible();
  await expect(page.getByTestId("map-navigation")).toContainText(/Remaining|ETA/);

  // Raster has no native bearing; the control must be disabled, not lie.
  await expect(page.getByRole("button", { name: /North up|Heading up/ })).toBeDisabled();

  // Auto-follow persists the intent and switches the camera on selection.
  const autoFollow = camera.getByRole("button", { name: "Auto-follow" });
  await autoFollow.click();
  await expect(autoFollow).toHaveAttribute("aria-pressed", "true");
  await autoFollow.click();
  await expect(autoFollow).toHaveAttribute("aria-pressed", "false");

  await camera.getByRole("button", { name: "Overview" }).click();
  await expect(camera.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-navigation")).toBeVisible();
});





