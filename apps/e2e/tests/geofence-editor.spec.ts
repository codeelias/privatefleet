/**
 * Visual geofence editor acceptance: the map is the drawing surface.
 * The demo API does not persist geofences, so this test covers drawing,
 * vertex counting and undo/cancel without saving.
 */
import { expect, test } from "@playwright/test";
import { WEB, resetScenario } from "./helpers";

test.skip(({ isMobile }) => Boolean(isMobile), "desktop geofence editor only");

test("Geofences: draw and reshape a fence on the map", async ({ page }) => {
  await resetScenario("morning-rush");
  await page.goto(WEB);
  await page.getByRole("button", { name: "Geofences" }).click();
  await expect(page.getByTestId("geofence-map")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Draw the fence, not the coordinates" })).toBeVisible();

  await page.getByRole("button", { name: "Draw new fence" }).click();
  const box = await page.getByTestId("geofence-map").boundingBox();
  expect(box).not.toBeNull();

  const points = [
    { x: box!.x + box!.width * 0.3, y: box!.y + box!.height * 0.35 },
    { x: box!.x + box!.width * 0.45, y: box!.y + box!.height * 0.35 },
    { x: box!.x + box!.width * 0.45, y: box!.y + box!.height * 0.5 },
  ];
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(120);
  }
  await expect(page.getByText(/3 vertices/)).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/2 vertices/)).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Click the map to start the fence")).toBeVisible();
});
