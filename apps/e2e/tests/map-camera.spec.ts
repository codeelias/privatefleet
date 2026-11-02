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

  const follow = page.getByRole("button", { name: "Follow" });
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect(page.getByTestId("map-confidence")).toBeVisible();
  await expect(page.getByTestId("map-navigation")).toContainText(/Remaining|ETA/);

  // Raster has no native bearing; the control must be disabled, not lie.
  await expect(page.getByRole("button", { name: /North up|Heading up/ })).toBeDisabled();

  const camera = page.getByTestId("map-camera-controls");
  await camera.getByRole("button", { name: "Overview" }).click();
  await expect(camera.getByRole("button", { name: "Overview" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-navigation")).toBeVisible();
});

