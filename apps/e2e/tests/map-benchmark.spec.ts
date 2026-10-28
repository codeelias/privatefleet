import { expect, test } from "@playwright/test";
import { API, WEB, resetScenario } from "./helpers";

/**
 * Map performance gate (docs/17.5): 250 active vehicles in one demo
 * tenant, moving through the real telemetry path. Records accepted-GPS to
 * visible-marker latency (p50/p95/p99) and render frame times.
 *
 * This test measures and reports; the gate is only called green when the
 * recorded p95 meets the contract in docs/17.5.
 */
test("250-vehicle fleet: marker latency and frame times", async ({
  page,
  request,
  isMobile,
}, testInfo) => {
  test.skip(isMobile, "dispatcher performance gate runs on the desktop profile");
  test.setTimeout(300_000);

  await resetScenario("morning-rush");
  const load = await request.post(`${API}/v1/demo/load`, { data: { count: 250 } });
  expect(load.ok()).toBe(true);
  expect(((await load.json()) as { vehicles: number }).vehicles).toBe(250);

  try {
    await page.goto(`${WEB}/?benchmark=1`);
    await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible({
      timeout: 30_000,
    });
    // Every loaded vehicle has a marker.
    await expect
      .poll(async () => page.locator('[aria-label^="Select "]').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(250);

    // Let telemetry run long enough to collect a representative sample.
    await page.waitForTimeout(20_000);
    const result = await page.evaluate(() => {
      const bench = (window as unknown as {
        __fleetBench?: { snapshot: () => unknown };
      }).__fleetBench;
      return bench ? bench.snapshot() : null;
    });
    expect(result).not.toBeNull();
    console.log("BENCHMARK", JSON.stringify(result));
    await testInfo.attach("benchmark.json", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    const snapshot = result as {
      samples: number;
      p95Ms: number;
      frames: { p95Ms: number };
    };
    // Measurement validity: enough samples to trust the percentile.
    expect(snapshot.samples).toBeGreaterThan(100);
  } finally {
    await request.delete(`${API}/v1/demo/load`);
  }
});
