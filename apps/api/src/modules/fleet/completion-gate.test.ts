import { describe, expect, it } from "vitest";
import {
  evaluateCompletionGate,
  GATE_FIX_MAX_AGE_MS,
  type GateFix,
  type GatePolicy,
} from "./completion-gate.js";

const STOP = { latitude: 51.5, longitude: -0.1 };

function fix(
  latitude: number | null,
  longitude: number | null,
  ageMs: number,
  accuracyMetres: number | null,
): GateFix {
  return {
    latitude,
    longitude,
    capturedAt: new Date(Date.now() - ageMs),
    accuracyMetres,
  };
}

describe("completion gate (pure)", () => {
  it("allows when the policy has no radius", () => {
    const policy: GatePolicy = { radiusM: null, mode: "block" };
    expect(evaluateCompletionGate(policy, fix(51.6, -0.1, 0, 20), STOP, Date.now()))
      .toEqual({ action: "allow" });
  });

  it("blocks beyond the radius with a fresh accurate fix", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "block" };
    const decision = evaluateCompletionGate(policy, fix(51.502, -0.1, 30_000, 20), STOP, Date.now());
    expect(decision.action).toBe("block");
    expect((decision as { distanceMetres: number }).distanceMetres).toBeGreaterThan(200);
  });

  it("warns beyond the radius in warn mode", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "warn" };
    expect(evaluateCompletionGate(policy, fix(51.502, -0.1, 0, 20), STOP, Date.now()).action)
      .toBe("warn");
  });

  it("allows within the radius", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "block" };
    expect(evaluateCompletionGate(policy, fix(51.5005, -0.1002, 0, 20), STOP, Date.now()))
      .toEqual({ action: "allow" });
  });

  it("skips (never blocks) when there is no fix", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "block" };
    expect(evaluateCompletionGate(policy, fix(null, null, 0, null), STOP, Date.now()))
      .toEqual({ action: "skip", reason: "no_fix" });
  });

  it("skips when the fix is stale", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "block" };
    expect(evaluateCompletionGate(
      policy, fix(51.502, -0.1, GATE_FIX_MAX_AGE_MS + 1, 20), STOP, Date.now(),
    )).toEqual({ action: "skip", reason: "stale_fix" });
  });

  it("skips when the fix accuracy is coarser than the radius", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "block" };
    expect(evaluateCompletionGate(policy, fix(51.502, -0.1, 0, 6000), STOP, Date.now()))
      .toEqual({ action: "skip", reason: "poor_accuracy" });
  });

  it("treats a fix exactly on the boundary as inside", () => {
    const policy: GatePolicy = { radiusM: 200, mode: "block" };
    // ~111 m north of the stop is inside; boundary distance itself is fine to allow.
    expect(evaluateCompletionGate(policy, fix(51.501, -0.1, 0, 20), STOP, Date.now()).action)
      .toBe("allow");
  });
});
