import { describe, expect, it } from "vitest";
import { reconcileRoutes, routesChanged, routesSignature } from "./routes";

const previous = [
  {
    vehicleId: "v1",
    driverId: "d1",
    points: [
      { latitude: 51.51, longitude: -0.13 },
      { latitude: 51.52, longitude: -0.1 },
    ],
  },
];

describe("route reconciliation", () => {
  it("adopts valid incoming routes", () => {
    const incoming = [
      {
        vehicleId: "v1",
        driverId: "d1",
        points: [
          { latitude: 51.515, longitude: -0.12 },
          { latitude: 51.525, longitude: -0.09 },
        ],
      },
    ];
    const result = reconcileRoutes(previous, incoming);
    expect(result.routes).toEqual(incoming);
    expect(result.invalidCount).toBe(0);
    expect(result.usedFallback).toBe(false);
    expect(result.signature).toBe(routesSignature(incoming));
  });

  it("retains the last valid route when a routing update is empty or invalid", () => {
    const empty = reconcileRoutes(previous, []);
    expect(empty.routes).toEqual(previous);
    expect(empty.usedFallback).toBe(true);

    const invalid = reconcileRoutes(previous, [
      { vehicleId: "v1", driverId: "d1", points: [] },
    ]);
    expect(invalid.routes).toEqual(previous);
    expect(invalid.usedFallback).toBe(true);
    expect(invalid.invalidCount).toBe(1);
  });

  it("draws only valid routes when the update is partially invalid", () => {
    const good = {
      vehicleId: "v2",
      driverId: "d2",
      points: [
        { latitude: 51.4, longitude: -0.2 },
        { latitude: 51.45, longitude: -0.15 },
      ],
    };
    const result = reconcileRoutes(previous, [good, { vehicleId: "v3", points: [] }]);
    expect(result.routes).toEqual([good]);
    expect(result.invalidCount).toBe(1);
    expect(result.usedFallback).toBe(false);
  });

  it("detects geometry changes by signature", () => {
    const signature = routesSignature(previous);
    expect(routesChanged(signature, signature)).toBe(false);
    expect(routesChanged(signature, signature + "x")).toBe(true);
  });
});
