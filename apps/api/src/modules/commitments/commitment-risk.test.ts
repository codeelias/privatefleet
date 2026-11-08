import { describe, expect, it } from "vitest";
import {
  assessCommitmentRisk,
  MARGIN_THREAT_MS,
  STALE_FIX_MS,
  STATIONARY_THREAT_MS,
} from "./commitment-risk.js";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const STOP = "11111111-1111-4111-8111-111111111111";

function base(overrides: Partial<Parameters<typeof assessCommitmentRisk>[0]> = {}) {
  return {
    nowMs: NOW,
    stopId: STOP,
    stopStatus: "pending",
    windowStart: new Date(NOW - 30 * 60000).toISOString(),
    windowEnd: new Date(NOW + 45 * 60000).toISOString(),
    plannedArrivalAt: new Date(NOW + 20 * 60000).toISOString(),
    fixCapturedAt: new Date(NOW).toISOString(),
    fixAccuracyMetres: 20,
    stationarySinceMs: 0,
    ...overrides,
  };
}

describe("commitment risk engine (pure)", () => {
  it("terminal stops are never scored", () => {
    for (const status of ["completed", "skipped", "failed"]) {
      expect(assessCommitmentRisk(base({ stopStatus: status })).kind).toBe("none");
    }
  });

  it("no committed window is not a threat", () => {
    expect(assessCommitmentRisk(base({ windowEnd: null })).kind).toBe("none");
  });

  it("a stale plan is never scored", () => {
    expect(
      assessCommitmentRisk(
        base({ plannedArrivalAt: new Date(NOW - 5 * 60000).toISOString() }),
      ).kind,
    ).toBe("none");
  });

  it("a planned arrival after the window is a late planned_breach", () => {
    const result = assessCommitmentRisk(
      base({ plannedArrivalAt: new Date(NOW + 60 * 60000).toISOString() }),
    );
    expect(result.kind).toBe("threat");
    if (result.kind === "threat") {
      expect(result.threatClass).toBe("planned_breach");
      expect(result.level).toBe("late");
      expect(result.reasons.join(" ")).toContain("after the committed window");
    }
  });

  it("a closing window is window_pressure at_risk", () => {
    const result = assessCommitmentRisk(
      base({
        windowEnd: new Date(NOW + 10 * 60000).toISOString(),
        plannedArrivalAt: new Date(NOW + 5 * 60000).toISOString(),
      }),
    );
    expect(result.kind).toBe("threat");
    if (result.kind === "threat") {
      expect(result.threatClass).toBe("window_pressure");
      expect(result.level).toBe("at_risk");
    }
  });

  it("an arrived stop is not scored", () => {
    const result = assessCommitmentRisk(
      base({
        stopStatus: "arrived",
        plannedArrivalAt: new Date(NOW - 1 * 60000).toISOString(),
      }),
    );
    expect(result.kind).toBe("none");
  });

  it("stationary + thin margin is a threat; stationary + healthy margin is not", () => {
    const threat = assessCommitmentRisk(
      base({
        stationarySinceMs: STATIONARY_THREAT_MS + 60_000,
        windowEnd: new Date(NOW + MARGIN_THREAT_MS - 60_000).toISOString(),
      }),
    );
    expect(threat.kind).toBe("threat");
    if (threat.kind === "threat") {
      expect(threat.threatClass).toBe("stationary_diminishing_margin");
      expect(threat.level).toBe("at_risk");
    }
    const healthy = assessCommitmentRisk(
      base({
        stationarySinceMs: STATIONARY_THREAT_MS + 60_000,
        windowEnd: new Date(NOW + 120 * 60000).toISOString(),
      }),
    );
    expect(healthy.kind).toBe("none"); // waiting is working
  });

  it("a stale fix never scores a stationary threat", () => {
    const result = assessCommitmentRisk(
      base({
        stationarySinceMs: STATIONARY_THREAT_MS + 60_000,
        windowEnd: new Date(NOW + MARGIN_THREAT_MS - 60_000).toISOString(),
        fixCapturedAt: new Date(NOW - STALE_FIX_MS - 1000).toISOString(),
      }),
    );
    expect(result.kind).toBe("none"); // stale GPS is not live GPS
  });

  it("a healthy plan with a fresh fix is not a threat", () => {
    expect(assessCommitmentRisk(base()).kind).toBe("none");
  });

  it("the fingerprint is scope + threat class - plan version is not identity", () => {
    const a = assessCommitmentRisk(
      base({ plannedArrivalAt: new Date(NOW + 60 * 60000).toISOString() }),
    );
    const b = assessCommitmentRisk(
      base({ plannedArrivalAt: new Date(NOW + 90 * 60000).toISOString() }),
    );
    if (a.kind === "threat" && b.kind === "threat") {
      // Same stop + same threat class under different plans -> SAME identity.
      expect(a.fingerprint).toBe(b.fingerprint);
    } else {
      throw new Error("expected threats");
    }
  });

  it("distinct stops never share an identity", () => {
    const a = assessCommitmentRisk(
      base({ plannedArrivalAt: new Date(NOW + 60 * 60000).toISOString() }),
    );
    const b = assessCommitmentRisk(
      base({
        stopId: "22222222-2222-4222-8222-222222222222",
        plannedArrivalAt: new Date(NOW + 60 * 60000).toISOString(),
      }),
    );
    if (a.kind === "threat" && b.kind === "threat") {
      expect(a.fingerprint).not.toBe(b.fingerprint);
    } else {
      throw new Error("expected threats");
    }
  });
});
