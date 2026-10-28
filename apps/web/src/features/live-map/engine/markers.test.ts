import { describe, expect, it } from "vitest";
import { hitTest, initials, vehicleColour, type CanvasVehicle } from "./markers";

function vehicle(overrides: Partial<CanvasVehicle> = {}): CanvasVehicle {
  return {
    id: "v1",
    label: "Sarah Reed",
    status: "on_route",
    stale: false,
    selected: false,
    x: 100,
    y: 100,
    ...overrides,
  };
}

describe("canvas vehicle markers", () => {
  it("derives initials and status colours truthfully", () => {
    expect(initials("Sarah Reed")).toBe("SR");
    expect(initials("Mo")).toBe("M");
    expect(initials("")).toBe("?");
    expect(vehicleColour("on_route", false)).toBe("#22C55E");
    expect(vehicleColour("maintenance", false)).toBe("#F59E0B");
    expect(vehicleColour("on_route", true)).toBe("#64748B");
  });

  it("hit-tests the nearest marker inside the radius only", () => {
    const vehicles = [vehicle(), vehicle({ id: "v2", x: 130, y: 100 })];
    expect(hitTest(vehicles, 102, 101)).toBe("v1");
    expect(hitTest(vehicles, 128, 100)).toBe("v2");
    expect(hitTest(vehicles, 112, 100)).toBe("v1");
    expect(hitTest(vehicles, 200, 200)).toBeNull();
  });
});

