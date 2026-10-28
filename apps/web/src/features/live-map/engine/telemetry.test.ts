import { describe, expect, it } from "vitest";
import { acceptTelemetry, coalesceSamples, staleVehicleIds, type TrackMap } from "./telemetry";

function sample(overrides: Partial<Parameters<typeof acceptTelemetry>[1]> = {}) {
  return {
    vehicleId: "v1",
    latitude: 51.51,
    longitude: -0.12,
    capturedAt: "2026-10-28T09:00:00.000Z",
    sequenceNo: 10,
    ...overrides,
  };
}

describe("telemetry ordering", () => {
  it("accepts the first sample and rejects older sequence numbers", () => {
    const now = Date.parse("2026-10-28T09:00:01.000Z");
    const first = acceptTelemetry({}, sample(), now);
    expect(first.accepted).toBe(true);

    const older = acceptTelemetry(
      first.track,
      sample({ sequenceNo: 9, capturedAt: "2026-10-28T08:59:59.000Z" }),
      now,
    );
    expect(older.accepted).toBe(false);
    expect(older.reason).toBe("stale_sequence");
    expect(older.track).toEqual(first.track);
  });

  it("rejects a sample captured before the last accepted one", () => {
    const now = Date.parse("2026-10-28T09:00:01.000Z");
    const first = acceptTelemetry({}, sample({ sequenceNo: 20 }), now);
    const older = acceptTelemetry(
      first.track,
      sample({ sequenceNo: 21, capturedAt: "2026-10-28T08:59:00.000Z" }),
      now,
    );
    expect(older.accepted).toBe(false);
    expect(older.reason).toBe("stale_time");
  });

  it("rejects invalid coordinates and accepts newer updates", () => {
    const now = Date.parse("2026-10-28T09:00:01.000Z");
    const invalid = acceptTelemetry({}, sample({ latitude: 200 }), now);
    expect(invalid.accepted).toBe(false);
    expect(invalid.reason).toBe("invalid_coordinates");

    const first = acceptTelemetry({}, sample(), now);
    const newer = acceptTelemetry(
      first.track,
      sample({ sequenceNo: 11, capturedAt: "2026-10-28T09:00:02.000Z", latitude: 51.52 }),
      now,
    );
    expect(newer.accepted).toBe(true);
    const track: TrackMap = newer.track;
    expect(track.v1?.latitude).toBe(51.52);
    expect(track.v1?.sequenceNo).toBe(11);
  });
});

describe("staleness and coalescing", () => {
  it("marks vehicles stale when no fresh sample arrives", () => {
    const now = Date.parse("2026-10-28T09:00:00.000Z");
    const track: TrackMap = {
      v1: {
        latitude: 51.5,
        longitude: -0.1,
        capturedAtMs: now - 30_000,
        sequenceNo: 5,
        acceptedAtMs: now - 30_000,
      },
      v2: {
        latitude: 51.6,
        longitude: -0.2,
        capturedAtMs: now - 1_000,
        sequenceNo: 6,
        acceptedAtMs: now - 1_000,
      },
    };
    const stale = staleVehicleIds(track, now, 10_000);
    expect(stale.has("v1")).toBe(true);
    expect(stale.has("v2")).toBe(false);
  });

  it("coalesces queued samples to the newest per vehicle", () => {
    const coalesced = coalesceSamples([
      sample({ sequenceNo: 3, capturedAt: "2026-10-28T09:00:03.000Z" }),
      sample({ sequenceNo: 5, capturedAt: "2026-10-28T09:00:05.000Z" }),
      sample({ vehicleId: "v2", sequenceNo: 1, capturedAt: "2026-10-28T09:00:01.000Z" }),
      sample({ sequenceNo: 4, capturedAt: "2026-10-28T09:00:04.000Z" }),
    ]);
    expect(coalesced).toHaveLength(2);
    expect(coalesced.find((entry) => entry.vehicleId === "v1")?.sequenceNo).toBe(5);
    expect(coalesced.find((entry) => entry.vehicleId === "v2")?.sequenceNo).toBe(1);
  });
});
