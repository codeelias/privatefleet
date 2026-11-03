import { describe, expect, it } from "vitest";
import { PfTideEstimator, type PositionObservation } from "./pf-tide";

function obs(overrides: Partial<PositionObservation>): PositionObservation {
  return {
    capturedAtMs: 1_000,
    receivedAtMs: 1_200,
    latitude: 51.5,
    longitude: -0.12,
    accuracyMetres: 8,
    satellitesUsed: 12,
    source: "gnss",
    movementState: "unknown",
    ...overrides,
  };
}

describe("PfTideEstimator (shadow core)", () => {
  it("holds a stationary vehicle and shrinks uncertainty", () => {
    const est = new PfTideEstimator();
    let t = 0;
    let snap = est.process(obs({ capturedAtMs: t, movementState: "stationary", speedMps: 0.3 }), t);
    for (let i = 0; i < 6; i += 1) {
      t += 10_000;
      snap = est.process(
        obs({
          capturedAtMs: t,
          movementState: "stationary",
          speedMps: 0.4,
          latitude: 51.5 + (i % 2 === 0 ? 2 : -2) / 110_540, // ~2 m jitter
        }),
        t,
      );
    }
    expect(snap.motionMode).toBe("STOPPED");
    expect(snap.accepted).toBe(true);
    expect(snap.correctedSigmaM).toBeLessThan(8);
    expect(Math.abs(snap.corrected.latitude - 51.5)).toBeLessThan(0.0001);
  });

  it("rejects a statistically impossible jump (NIS)", () => {
    const est = new PfTideEstimator();
    const t0 = 1_000;
    const first = est.process(obs({ capturedAtMs: t0, accuracyMetres: 5 }), t0);
    const jumped = est.process(
      obs({ capturedAtMs: t0 + 10_000, accuracyMetres: 5, latitude: 51.502, longitude: -0.115 }),
      t0 + 10_000,
    );
    expect(first.accepted).toBe(true);
    expect(jumped.accepted).toBe(false);
    expect(jumped.rejectionReason).toBe("NIS reject");
    expect(Math.abs(jumped.corrected.latitude - 51.5)).toBeLessThan(0.0001);
  });

  it("inflates uncertainty for network fixes versus GNSS", () => {
    const gnss = new PfTideEstimator();
    const net = new PfTideEstimator();
    const a = gnss.process(obs({ accuracyMetres: 10, source: "gnss", satellitesUsed: 12 }), 1_000);
    const b = net.process(obs({ accuracyMetres: 10, source: "network", satellitesUsed: 0 }), 1_000);
    expect(b.correctedSigmaM).toBeGreaterThan(a.correctedSigmaM);
  });

  it("reconciles an out-of-order observation within the replay window", () => {
    const est = new PfTideEstimator();
    const later = est.process(
      obs({ capturedAtMs: 20_000, latitude: 51.501, movementState: "moving", speedMps: 5 }),
      20_000,
    );
    expect(later.accepted).toBe(true);
    // A delayed measurement from 10 s earlier arrives afterwards.
    const reconciled = est.process(
      obs({ capturedAtMs: 10_000, latitude: 51.5005, movementState: "moving", speedMps: 5 }),
      21_000,
    );
    // Final snapshot corresponds to the newest buffered observation (t=20 s).
    expect(reconciled.ageMs).toBe(1_000);
    expect(reconciled.fixStatus).not.toBe("COASTING");
    expect(reconciled.corrected.latitude).toBeGreaterThan(51.5005);
    expect(reconciled.corrected.latitude).toBeLessThanOrEqual(51.501);
  });

  it("grows prediction uncertainty with time and expires", () => {
    const est = new PfTideEstimator();
    const snap = est.process(obs({ capturedAtMs: 5_000, speedMps: 8, movementState: "moving" }), 5_000);
    expect(snap.predictedSigmaM).toBeGreaterThanOrEqual(snap.correctedSigmaM);
    expect(snap.validUntilMs).toBeLessThanOrEqual(5_000 + 30_000);
  });

  it("coasts honestly with no observations", () => {
    const est = new PfTideEstimator();
    const snap = est.process(obs({ capturedAtMs: 1_000 }), 60_000);
    expect(snap.fixStatus).toBe("COASTING");
  });
});
