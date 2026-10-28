import { expect, test } from "@playwright/test";
import { fleetState, resetScenario, WEB } from "./helpers";

/**
 * Route-correctness acceptance (docs/14.2, ADR-0010): road-following
 * geometry from the same scenario state as markers, selection highlight,
 * scenario switching, movement along the route, and an honest failure
 * state. Geometry is precomputed OSRM demo data (labelled as such).
 */

function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const lat = (a.latitude + b.latitude) / 2;
  const dx = (b.longitude - a.longitude) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const dy = (b.latitude - a.latitude) * 110_540;
  return Math.sqrt(dx * dx + dy * dy);
}

test("Live map: road-following routes match assignments and selection", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "dispatcher map layout is desktop-only in the demo");
  await resetScenario("morning-rush");
  const state = await fleetState();

  // 1) Road geometry, not straight lines: dense sampled routes.
  expect(state.routes.length).toBe(3);
  for (const route of state.routes) {
    expect(route.points.length).toBeGreaterThanOrEqual(100);
  }

  // 2) Each driver's route starts where their vehicle is.
  for (const route of state.routes) {
    const vehicle = state.vehicles.find((v) => v.id === route.vehicleId);
    const start = route.points[0];
    const current = vehicle?.location;
    expect(start).toBeTruthy();
    expect(current).toBeTruthy();
    if (start && current) {
      expect(metresBetween(start, current)).toBeLessThan(400);
    }
  }

  // 3) Every assigned stop is on that driver's route (roads near stops).
  for (const job of state.jobs) {
    if (!job.assignedDriverId) {
      continue;
    }
    const route = state.routes.find((r) => r.driverId === job.assignedDriverId);
    expect(route).toBeTruthy();
    for (const stop of job.stops) {
      const nearest = Math.min(
        ...(route?.points ?? []).map((p) => metresBetween(p, stop.location)),
      );
      expect(nearest).toBeLessThan(400);
    }
  }

  await page.goto(WEB);
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();

  // 4) Selecting a vehicle highlights its route (stroke width 5 vs 3).
  const pin = page.locator('[title*="VAN-02"]').first();
  await expect(pin).toBeVisible();
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  const highlighted = page.locator('path.leaflet-interactive[stroke-width="5"]');
  await expect(highlighted).toHaveCount(1);
  await expect(page.locator('path.leaflet-interactive[stroke-width="3"]')).toHaveCount(2);

  // 5) Movement follows the route (next position still on the geometry).
  const before = await fleetState();
  await page.waitForTimeout(4_500);
  const after = await fleetState();
  const movedVehicle = after.vehicles.find(
    (v) => v.id === before.vehicles[0]?.id,
  );
  const previous = before.vehicles[0]?.location;
  expect(movedVehicle?.location).toBeTruthy();
  expect(previous).toBeTruthy();
  if (movedVehicle?.location && previous) {
    expect(metresBetween(movedVehicle.location, previous)).toBeGreaterThan(1);
    const route = after.routes.find((r) => r.vehicleId === movedVehicle.id);
    const nearest = Math.min(
      ...(route?.points ?? []).map((p) => metresBetween(p, movedVehicle.location as {
        latitude: number;
        longitude: number;
      })),
    );
    expect(nearest).toBeLessThan(300);
  }

  // 6) Scenario switching keeps the map consistent.
  await page.getByRole("button", { name: "Emergency" }).click();
  await expect(page.getByRole("button", { name: "Emergency" })).toBeEnabled();
  await expect(page.locator('path.leaflet-interactive')).toHaveCount(3);
  await expect(page.getByText("Unassigned jobs - drag onto a driver or select")).toBeVisible();

  // 7) No false "geometry unavailable" warning while routes exist.
  await expect(page.getByText(/Route geometry unavailable/)).toHaveCount(0);
});



