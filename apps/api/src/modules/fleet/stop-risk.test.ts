import { describe, expect, it } from "vitest";
import { AT_RISK_WINDOW_MS, stopRisk } from "./stop-risk.js";

const NOW = Date.parse("2026-11-07T12:00:00Z");

describe("stop risk (pure)", () => {
  it("terminal stops carry no risk", () => {
    for (const status of ["completed", "skipped", "failed"]) {
      expect(stopRisk({ status, plannedArrivalAt: new Date(NOW), windowEnd: new Date(NOW), nowMs: NOW }))
        .toBeUndefined();
    }
  });

  it("no plan is unknown", () => {
    expect(stopRisk({ status: "pending", plannedArrivalAt: null, windowEnd: new Date(NOW), nowMs: NOW }))
      .toBe("unknown");
  });

  it("planned after the window is late", () => {
    expect(stopRisk({
      status: "pending",
      plannedArrivalAt: new Date(NOW + 20 * 60_000),
      windowEnd: new Date(NOW + 10 * 60_000),
      nowMs: NOW,
    })).toBe("late");
  });

  it("window closing soon is at_risk", () => {
    expect(stopRisk({
      status: "pending",
      plannedArrivalAt: new Date(NOW + 8 * 60_000),
      windowEnd: new Date(NOW + AT_RISK_WINDOW_MS - 1_000),
      nowMs: NOW,
    })).toBe("at_risk");
  });

  it("plenty of time is on_track", () => {
    expect(stopRisk({
      status: "pending",
      plannedArrivalAt: new Date(NOW + 30 * 60_000),
      windowEnd: new Date(NOW + 60 * 60_000),
      nowMs: NOW,
    })).toBe("on_track");
  });

  it("a plan without a window is on_track when in the future", () => {
    expect(stopRisk({
      status: "pending",
      plannedArrivalAt: new Date(NOW + 30 * 60_000),
      windowEnd: null,
      nowMs: NOW,
    })).toBe("on_track");
  });

  it("a stale plan is unknown, never risky", () => {
    expect(stopRisk({
      status: "pending",
      plannedArrivalAt: new Date(NOW - 5 * 24 * 60 * 60_000),
      windowEnd: new Date(NOW - 5 * 24 * 60 * 60_000 + 60 * 60_000),
      nowMs: NOW,
    })).toBe("unknown");
  });

  it("a closed window is unknown even with a future plan", () => {
    expect(stopRisk({
      status: "pending",
      plannedArrivalAt: new Date(NOW + 30 * 60_000),
      windowEnd: new Date(NOW - 60 * 60_000),
      nowMs: NOW,
    })).toBe("unknown");
  });
});
