import { expect, test } from "@playwright/test";
import { API, WEB, resetScenario } from "./helpers";

/**
 * DPI fidelity gate (docs/17.13): the same 250-vehicle measurement at a
 * 2x device pixel ratio, so marker sharpness is measured rather than
 * assumed and the backing-store cap is validated.
 */
test.use({ deviceScaleFactor: 2 });

test("250-vehicle fleet at 2x DPR: true-paint latency and frame times", async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher performance gate runs on the desktop profile");
  test.setTimeout(300_000);

  await resetScenario("morning-rush");
  const load = await request.post(`${API}/v1/demo/load`, { data: { count: 250 } });
  expect(load.ok()).toBe(true);

  try {
    await page.goto(`${WEB}/?benchmark=1`);
    await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("vehicle-canvas")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(20_000);
    const result = await page.evaluate(() => {
      const bench = (window as unknown as {
        __fleetBench?: { snapshot: () => unknown };
      }).__fleetBench;
      return bench ? bench.snapshot() : null;
    });
    console.log("BENCHMARK_DPR2", JSON.stringify(result));
    const snapshot = result as { samples: number };
    expect(snapshot.samples).toBeGreaterThan(100);
  } finally {
    await request.delete(`${API}/v1/demo/load`);
  }
});
