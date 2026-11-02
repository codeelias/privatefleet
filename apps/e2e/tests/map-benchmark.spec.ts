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

  // Map-only reference: same page, 3 demo vehicles, no load. Separates
  // map/compositor cost from fleet-marker cost in the same environment.
  await page.goto(`${WEB}/?benchmark=1&map=raster`);
  await expect(page.getByRole("button", { name: "Open unassigned jobs" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);
  const mapOnly = await page.evaluate(() => {
    const bench = (window as unknown as { __fleetBench?: { snapshot: () => unknown } }).__fleetBench;
    return bench ? bench.snapshot() : null;
  });
  console.log("BENCHMARK_MAP_ONLY", JSON.stringify(mapOnly));

  const load = await request.post(`${API}/v1/demo/load`, { data: { count: 250 } });
  expect(load.ok()).toBe(true);
  expect(((await load.json()) as { vehicles: number }).vehicles).toBe(250);

  try {
    await page.reload();
    await expect(page.getByRole("button", { name: "Open unassigned jobs" })).toBeVisible({
      timeout: 30_000,
    });
    // Large fleets render through the single canvas marker layer.
    const canvas = page.locator('[data-testid="vehicle-canvas"]');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          canvas.evaluate((element) => {
            const node = element as HTMLCanvasElement;
            return node.width > 0 && node.height > 0;
          }),
        { timeout: 30_000 },
      )
      .toBe(true);

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
      body: JSON.stringify({ mapOnly, fleet250: result }, null, 2),
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


