import { describe, expect, it } from "vitest";
import { routeSignature, validateRoutePath } from "./geo";

const points = [
  { latitude: 51.515, longitude: -0.132 },
  { latitude: 51.5204, longitude: -0.1046 },
  { latitude: 51.5265, longitude: -0.078 },
];

describe("route invariants", () => {
  it("accepts a valid LineString and reports road length", () => {
    const result = validateRoutePath({ vehicleId: "v1", driverId: "d1", points });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.lengthMetres).toBeGreaterThan(1000);
  });

  it("rejects invalid coordinates and short routes, but tolerates OSRM duplicate points", () => {
    expect(
      validateRoutePath({ vehicleId: "v1", points: [{ latitude: Number.NaN, longitude: 0 }] }).valid,
    ).toBe(false);
    expect(validateRoutePath({ vehicleId: "v1", points: [points[0]!] }).valid).toBe(false);
    const duplicated = [points[0]!, { ...points[0]! }, points[1]!];
    const result = validateRoutePath({ vehicleId: "v1", points: duplicated });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("produces a stable signature and one that changes with geometry", () => {
    const a = validateRoutePath({ vehicleId: "v1", driverId: "d1", points });
    expect(a.valid).toBe(true);
    const sigA = routeSignature({ vehicleId: "v1", driverId: "d1", points });
    const sigAgain = routeSignature({ vehicleId: "v1", driverId: "d1", points });
    expect(sigA).toBe(sigAgain);

    const moved = points.map((point, index) =>
      index === 1 ? { ...point, latitude: point.latitude + 0.001 } : point,
    );
    expect(routeSignature({ vehicleId: "v1", driverId: "d1", points: moved })).not.toBe(sigA);
  });
});

