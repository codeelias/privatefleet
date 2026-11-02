import { describe, expect, it } from "vitest";
import {
  bearingDegrees,
  confidenceFor,
  projectPointToRoute,
  resolveVehicleFix,
  smoothAngle,
} from "./positioning";
import type { VehicleDto } from "@privatefleet/contracts";

const route = {
  vehicleId: "vehicle-1",
  driverId: "driver-1",
  points: [
    { latitude: 51.5, longitude: -0.12 },
    { latitude: 51.5, longitude: -0.11 },
    { latitude: 51.5, longitude: -0.1 },
  ],
};

function vehicle(overrides: Partial<VehicleDto> = {}): VehicleDto {
  return {
    id: "vehicle-1",
    registration: "VAN-01",
    vehicleType: "van",
    status: "on_route",
    driverId: "driver-1",
    location: { latitude: 51.5001, longitude: -0.115 },
    stale: false,
    lastSeenAt: new Date().toISOString(),
    accuracyMetres: 8,
    ...overrides,
  };
}

describe("route projection", () => {
  it("projects a nearby fix onto the nearest planned segment", () => {
    const projection = projectPointToRoute({ latitude: 51.5002, longitude: -0.115 }, route);
    expect(projection).not.toBeNull();
    expect(projection!.distanceM).toBeLessThan(30);
    expect(projection!.snapped.latitude).toBeCloseTo(51.5, 4);
    expect(projection!.remainingM).toBeGreaterThan(0);
  });

  it("keeps progress monotonic along a multi-leg route", () => {
    const first = projectPointToRoute({ latitude: 51.5, longitude: -0.115 }, route)!;
    const later = projectPointToRoute({ latitude: 51.5, longitude: -0.105 }, route)!;
    expect(later.routeProgressM).toBeGreaterThan(first.routeProgressM);
    expect(later.remainingM).toBeLessThan(first.remainingM);
  });
});

describe("confidence", () => {
  it("classifies a fresh accurate route-matched fix as high", () => {
    expect(
      confidenceFor({ stale: false, ageMs: 2_000, accuracyMetres: 8, distanceToRouteM: 12 }),
    ).toBe("high");
  });

  it("never calls a stale fix high, regardless of device accuracy", () => {
    expect(
      confidenceFor({ stale: true, ageMs: 2_000, accuracyMetres: 2, distanceToRouteM: 1 }),
    ).toBe("low");
  });

  it("degrades an inaccurate far fix", () => {
    expect(
      confidenceFor({ stale: false, ageMs: 2_000, accuracyMetres: 120, distanceToRouteM: 80 }),
    ).toBe("low");
  });
});

describe("displayed fix", () => {
  const now = Date.now();

  it("snaps only when the raw fix is close enough and fresh", () => {
    const fix = resolveVehicleFix(vehicle({ lastSeenAt: new Date(now).toISOString() }), route, undefined, now);
    expect(fix).not.toBeNull();
    expect(fix!.snapped).toBe(true);
    expect(fix!.confidence).toBe("high");
    expect(fix!.location.latitude).toBeCloseTo(51.5, 4);
  });

  it("accepts the API timestamp form with a short UTC offset", () => {
    const fix = resolveVehicleFix(
      vehicle({ lastSeenAt: "2026-11-02 11:27:23+00" }),
      route,
      undefined,
      Date.parse("2026-11-02T11:27:30Z"),
    );
    expect(fix?.ageMs).toBe(7000);
    expect(fix?.confidence).not.toBe("unknown");
  });

  it("rejects an implausible jump and marks the retained fix low confidence", () => {
    const previous = resolveVehicleFix(
      vehicle({ location: { latitude: 51.5, longitude: -0.12 }, lastSeenAt: new Date(now - 1_000).toISOString() }),
      route,
      undefined,
      now - 1_000,
    )!;
    const jump = resolveVehicleFix(
      vehicle({ location: { latitude: 51.55, longitude: -0.05 }, lastSeenAt: new Date(now).toISOString() }),
      route,
      previous,
      now,
    )!;
    expect(jump.outlier).toBe(true);
    expect(jump.confidence).toBe("low");
    expect(jump.location.latitude).toBe(previous.location.latitude);
  });

  it("smooths heading through north instead of taking the long way round", () => {
    expect(smoothAngle(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(bearingDegrees({ latitude: 51.5, longitude: -0.12 }, { latitude: 51.5, longitude: -0.11 })).toBeCloseTo(90, 1);
  });
});
