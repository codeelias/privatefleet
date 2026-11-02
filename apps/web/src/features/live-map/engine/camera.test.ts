import { describe, expect, it } from "vitest";
import { adaptiveFollowZoom, planFollowCamera } from "./camera";

describe("follow camera", () => {
  it("zooms in at low speed and out at high speed", () => {
    expect(adaptiveFollowZoom(0)).toBe(16);
    expect(adaptiveFollowZoom(7)).toBe(15.1);
    expect(adaptiveFollowZoom(20)).toBe(13.8);
  });

  it("looks ahead in the direction of travel", () => {
    const plan = planFollowCamera({ latitude: 51.5, longitude: -0.12 }, 90, 5, false);
    expect(plan.center.longitude).toBeGreaterThan(-0.12);
    expect(plan.center.latitude).toBeCloseTo(51.5, 5);
    expect(plan.lookAheadM).toBeGreaterThan(20);
    expect(plan.bearing).toBe(0);
  });

  it("rotates the camera only when bearing-up is enabled", () => {
    const plan = planFollowCamera({ latitude: 51.5, longitude: -0.12 }, 135, 0, true);
    expect(plan.bearing).toBe(135);
    expect(plan.zoom).toBe(16);
  });
});
