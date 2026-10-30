import { expect, test } from "@playwright/test";

/**
 * Default vector map regression guard: OpenFreeMap style/tiles must load
 * without policy-blocked responses, the MapLibre canvas must fill the card
 * (its CSS `position: relative` once collapsed the container to 0 height),
 * and the vehicle markers must render above the basemap.
 */
test("Live map: default vector basemap renders with vehicle markers", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");
  const failures: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("openfreemap") && res.status() >= 400) {
      failures.push(`${res.status()} ${res.url()}`);
    }
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("openfreemap")) {
      failures.push(`failed ${req.url()}`);
    }
  });

  await page.goto("http://127.0.0.1:5173/");
  await expect(page.getByText("Fleet Operations")).toBeVisible();
  await expect(page.getByText("vector map (OpenFreeMap liberty)")).toBeVisible();
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  const box = await canvas.boundingBox();
  const card = await page.locator('[data-testid="map-card"]').boundingBox();
  expect(box).not.toBeNull();
  expect(card).not.toBeNull();
  // The canvas must cover most of the card, not collapse to a 300px strip.
  expect(box!.height).toBeGreaterThan(card!.height * 0.9);
  await expect(page.locator('[title*="VAN-02"]').first()).toBeVisible();
  expect(failures, failures.join("\n")).toEqual([]);
});
