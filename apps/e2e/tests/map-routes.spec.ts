import { expect, test } from "@playwright/test";
import { fleetState, resetScenario, WEB } from "./helpers";

// The scenario sweep asserts every route point; allow a generous budget.
test.describe.configure({ timeout: 120_000 });

/**
 * Route-correctness acceptance (docs/16, ADR-0013).
 *
 * Demo fixtures are precomputed OSRM road geometry (labelled demo data).
 * This spec proves, for EVERY scenario, that the rendered geometry and
 * assignment state agree, and that simulated movement is distance-based.
 *
 * Documented tolerances (exact fixture coordinates, no geocoding):
 * - route origin vs vehicle position: 150 m
 * - stop vs its route leg: 120 m
 * - movement distance over elapsed time: 0.5x - 2.0x (speed * delta)
 */

const ORIGIN_TOLERANCE_M = 150;
const STOP_TOLERANCE_M = 120;
const DEMO_SPEED_MPS = 40_000 / 3_600;

function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const lat = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dx = (b.longitude - a.longitude) * 111_320 * Math.cos(lat);
  const dy = (b.latitude - a.latitude) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

function inLondon(point: { latitude: number; longitude: number }): boolean {
  // Greater London bbox. A swapped coordinate order (lat/lng reversed)
  // would fail this immediately, which is the RFC 7946 guard.
  return (
    point.latitude > 51.3 &&
    point.latitude < 51.7 &&
    point.longitude > -0.55 &&
    point.longitude < 0.3
  );
}

test("Live map: routes, assignments and scenarios are consistent", async ({ isMobile }) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");

  for (const scenario of ["morning-rush", "emergency", "proof"] as const) {
    await resetScenario(scenario);
    const state = await fleetState();

    // Geometry validity + coordinate order (London bbox).
    expect(state.routes.length).toBe(3);
    for (const route of state.routes) {
      expect(route.points.length).toBeGreaterThanOrEqual(50);
      for (const point of route.points) {
        expect(Number.isFinite(point.latitude)).toBe(true);
        expect(Number.isFinite(point.longitude)).toBe(true);
        expect(inLondon(point)).toBe(true);
      }
      const first = route.points[0];
      const second = route.points[1];
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(first).not.toEqual(second);
    }

    // Route/vehicle/assignment consistency.
    expect(state.routes.length).toBe(state.vehicles.length);
    for (const route of state.routes) {
      expect(state.vehicles.some((v) => v.id === route.vehicleId)).toBe(true);
      expect(state.drivers.some((d) => d.id === route.driverId)).toBe(true);
    }

    // Route origin agrees with the vehicle position.
    for (const route of state.routes) {
      const vehicle = state.vehicles.find((v) => v.id === route.vehicleId);
      expect(vehicle?.location).toBeTruthy();
      const start = route.points[0];
      if (vehicle?.location && start) {
        expect(metresBetween(start, vehicle.location)).toBeLessThan(ORIGIN_TOLERANCE_M);
      }
    }

    // Assigned stops are close to their driver's road geometry.
    // Sequence order is certified deterministically in the API unit test
    // (route-geometry.test.ts) from engine-snapped waypoint indices; an
    // out-and-back circuit cannot be ordered by proximity alone.
    for (const job of state.jobs) {
      if (!job.assignedDriverId) {
        continue;
      }
      const route = state.routes.find((r) => r.driverId === job.assignedDriverId);
      expect(route).toBeTruthy();
      for (const stop of job.stops) {
        const nearest = Math.min(
          ...(route?.points ?? []).map((point) => metresBetween(point, stop.location)),
        );
        expect(nearest).toBeLessThan(STOP_TOLERANCE_M);
      }
    }
  }
});

test("Live map: simulated movement is distance over time", async ({ isMobile }) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");

  await resetScenario("morning-rush");
  const before = await fleetState();
  const vehicleId = before.vehicles[0]?.id;
  expect(vehicleId).toBeTruthy();
  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  const after = await fleetState();
  const elapsedSeconds = (Date.now() - startedAt) / 1_000;

  const startPosition = before.vehicles.find((v) => v.id === vehicleId)?.location;
  const endPosition = after.vehicles.find((v) => v.id === vehicleId)?.location;
  expect(startPosition).toBeTruthy();
  expect(endPosition).toBeTruthy();

  console.log("MOVEMENT", JSON.stringify({ before: startPosition, after: endPosition, elapsedSeconds, scenario: before.scenario }));
  const travelled = metresBetween(startPosition!, endPosition!);
  const expected = DEMO_SPEED_MPS * elapsedSeconds;
  expect(travelled).toBeGreaterThan(expected * 0.5);
  expect(travelled).toBeLessThan(expected * 2.0);
});

test("Live map: selecting a vehicle highlights its route", async ({ page, isMobile }) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");

  await resetScenario("morning-rush");
  await page.goto(`${WEB}/?map=raster`);
  await expect(page.getByRole("button", { name: "Open unassigned jobs" })).toBeVisible();

  const pin = page.locator('[title*="VAN-02"]').first();
  await expect(pin).toBeVisible();
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('path.leaflet-interactive[stroke-width="6"]')).toHaveCount(1);
  await expect(page.locator('path.leaflet-interactive[stroke-width="4"]')).toHaveCount(2);

  // Scenario switching keeps the map consistent and never fakes geometry.
  await page.getByRole("button", { name: "Emergency" }).click();
  await expect(page.getByRole("button", { name: "Emergency" })).toBeEnabled();
  await expect(page.locator("path.leaflet-interactive")).toHaveCount(3);
  await expect(page.getByText(/Route geometry unavailable/)).toHaveCount(0);
});







