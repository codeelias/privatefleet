/**
 * Fixture certification (docs/16.5, ADR-0013): proves, for every demo
 * scenario, that the committed road geometry was generated through the
 * assigned stops in the approved order and that it starts at the driver.
 *
 * Order is certified from the generator's engine-snapped waypoint
 * indices, because proximity alone cannot order stops on an out-and-back
 * circuit (the same road is driven twice).
 */
import { describe, expect, it } from "vitest";
import type { ScenarioName } from "@privatefleet/contracts";
import { DRIVER_SEEDS, JOB_SEEDS } from "./data.js";
import { SCENARIO_ASSIGNMENTS } from "./assignments.js";
import { ROUTE_GEOMETRY } from "./route-geometry.js";

const SCENARIOS: ScenarioName[] = ["morning-rush", "emergency", "proof"];
const TOLERANCE_M = 120;

function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = b.latitude - a.latitude;
  const dLon = b.longitude - a.longitude;
  const latRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const x = dLon * 111_320 * Math.cos(latRad);
  const y = dLat * 110_540;
  return Math.sqrt(x * x + y * y);
}

function expectedWaypoints(scenario: ScenarioName, driver: number): Array<{ latitude: number; longitude: number }> {
  const seed = DRIVER_SEEDS[driver];
  if (!seed) {
    return [];
  }
  const waypoints = [{ ...seed.start }];
  for (const assignment of SCENARIO_ASSIGNMENTS[scenario].filter((a) => a.driver === driver)) {
    const job = JOB_SEEDS.find((candidate) => candidate.reference === assignment.ref);
    if (!job) {
      continue;
    }
    waypoints.push({ latitude: job.pickup.latitude, longitude: job.pickup.longitude });
    waypoints.push({ latitude: job.dropoff.latitude, longitude: job.dropoff.longitude });
  }
  return waypoints;
}

describe("demo route geometry fixtures", () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario}: routes start at the driver and visit assigned stops in order`, () => {
      for (const [driverIndex, seed] of DRIVER_SEEDS.entries()) {
        const fixture = ROUTE_GEOMETRY[scenario]?.[seed.vehicleId];
        expect(fixture).toBeTruthy();
        if (!fixture) {
          continue;
        }

        // Valid dense line geometry.
        expect(fixture.points.length).toBeGreaterThanOrEqual(50);
        const first = fixture.points[0];
        expect(first).toBeTruthy();
        expect(metresBetween(first!, seed.start)).toBeLessThan(TOLERANCE_M);

        // Every assigned stop, in the approved order, certified by the
        // generator's engine-snapped indices.
        const waypoints = expectedWaypoints(scenario, driverIndex);
        expect(fixture.waypoints.length).toBe(waypoints.length);
        let previousIndex = -1;
        let previousExpected: { latitude: number; longitude: number } | undefined;
        waypoints.forEach((expected, index) => {
          const routeIndex = fixture.waypoints[index];
          expect(routeIndex).toBeDefined();
          // Stops closer than the snap tolerance may share a route point;
          // otherwise the certified order must advance along the leg.
          const closeToPrevious =
            previousExpected !== undefined &&
            metresBetween(previousExpected, expected) <= TOLERANCE_M;
          if (closeToPrevious) {
            expect(routeIndex!).toBeGreaterThanOrEqual(previousIndex);
          } else {
            expect(routeIndex!).toBeGreaterThan(previousIndex);
          }
          previousIndex = routeIndex!;
          previousExpected = expected;
          const point = fixture.points[routeIndex!];
          expect(point).toBeTruthy();
          expect(metresBetween(point!, expected)).toBeLessThan(TOLERANCE_M);
        });
      }
    });
  }
});

