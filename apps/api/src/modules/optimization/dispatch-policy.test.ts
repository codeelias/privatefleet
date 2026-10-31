import { describe, expect, it } from "vitest";
import {
  DispatchPolicyError,
  presetPolicy,
  resolveVehiclePolicy,
  validatePolicy,
} from "./dispatch-policy.js";

describe("dispatch policy", () => {
  it("resolves every preset into explicit metre/second/visit limits", () => {
    for (const preset of ["local", "balanced", "extended"] as const) {
      const policy = presetPolicy(preset, 3);
      expect(policy.version).toBe(3);
      expect(policy.maxDistanceM).toBeGreaterThan(0);
      expect(policy.maxTravelTimeS).toBeGreaterThan(0);
      expect(policy.maxWorkingDurationS).toBeGreaterThanOrEqual(
        policy.maxTravelTimeS,
      );
      expect(policy.maxVisits).toBeGreaterThan(0);
      expect(() => validatePolicy(policy)).not.toThrow();
    }
  });

  it("applies per-vehicle overrides without changing the policy version", () => {
    const policy = presetPolicy("balanced", 7);
    const effective = resolveVehiclePolicy(policy, {
      maxDistanceM: 90_000,
      maxVisits: 20,
    });
    expect(effective.maxDistanceM).toBe(90_000);
    expect(effective.maxVisits).toBe(20);
    expect(effective.maxTravelTimeS).toBe(policy.maxTravelTimeS);
    expect(effective.maxWorkingDurationS).toBe(policy.maxWorkingDurationS);
    expect(effective.version).toBe(7);
  });

  it("keeps working duration and travel time separate and rejects inversion", () => {
    const policy = presetPolicy("balanced", 1);
    expect(policy.maxWorkingDurationS).not.toBe(policy.maxTravelTimeS);
    expect(() =>
      validatePolicy({
        ...policy,
        maxWorkingDurationS: policy.maxTravelTimeS - 1,
      }),
    ).toThrow(DispatchPolicyError);
  });

  it("rejects negative, fractional or absurd values", () => {
    const policy = presetPolicy("local", 1);
    expect(() => validatePolicy({ ...policy, maxDistanceM: 0 })).toThrow();
    expect(() => validatePolicy({ ...policy, maxVisits: 1.5 })).toThrow();
    expect(() =>
      validatePolicy({ ...policy, maxWorkingDurationS: 25 * 3600 }),
    ).toThrow();
  });
});
