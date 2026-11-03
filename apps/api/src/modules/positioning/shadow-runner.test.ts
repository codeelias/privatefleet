import { describe, expect, it } from "vitest";
import { observeVehiclePosition, shadowReports } from "./shadow-runner";
import type { PositionObservation } from "./pf-tide";

function obs(overrides: Partial<PositionObservation>): PositionObservation {
  return {
    capturedAtMs: 1_000,
    receivedAtMs: 1_100,
    latitude: 51.5,
    longitude: -0.12,
    accuracyMetres: 8,
    source: "gnss",
    satellitesUsed: 12,
    ...overrides,
  };
}

describe("shadow-runner", () => {
  it("mirrors observations and exposes a snapshot without touching production", () => {
    observeVehiclePosition("vehicle-a", obs({}));
    observeVehiclePosition("vehicle-a", obs({ capturedAtMs: 11_000, receivedAtMs: 11_100, latitude: 51.501 }));
    const report = shadowReports().find((entry) => entry.vehicleId === "vehicle-a");
    expect(report).toBeDefined();
    expect(report!.snapshot?.accepted).toBe(true);
    expect(report!.baseline.count).toBe(2);
  });

  it("bounds the replay history", () => {
    for (let index = 0; index < 600; index += 1) {
      observeVehiclePosition("vehicle-b", obs({ capturedAtMs: index * 10_000, receivedAtMs: index * 10_000 + 100 }));
    }
    const report = shadowReports().find((entry) => entry.vehicleId === "vehicle-b");
    expect(report!.baseline.count).toBeLessThanOrEqual(500);
  });
});
