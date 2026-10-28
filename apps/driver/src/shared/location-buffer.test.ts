import { describe, expect, it } from "vitest";
import {
  LOCATION_BUFFER_CAP,
  mergeFailed,
  pushSample,
  takeBatch,
  type LocationSample,
} from "./location-buffer";

function sample(latitude: number) {
  return { latitude, longitude: -0.12, capturedAt: new Date().toISOString() };
}

describe("location buffering", () => {
  it("caps the buffer by dropping the oldest samples", () => {
    let buffer: LocationSample[] = [];
    for (let index = 0; index < LOCATION_BUFFER_CAP + 5; index += 1) {
      buffer = pushSample(buffer, sample(index));
    }
    expect(buffer).toHaveLength(LOCATION_BUFFER_CAP);
    expect(buffer[0]?.latitude).toBe(5);
    expect(buffer[LOCATION_BUFFER_CAP - 1]?.latitude).toBe(LOCATION_BUFFER_CAP + 4);
  });

  it("drains in order and merges failures back at the head", () => {
    const buffer = [sample(1), sample(2), sample(3)];
    const { batch, rest } = takeBatch(buffer, 2);
    expect(batch.map((entry) => entry.latitude)).toEqual([1, 2]);
    expect(rest.map((entry) => entry.latitude)).toEqual([3]);

    const merged = mergeFailed(rest, batch);
    expect(merged.map((entry) => entry.latitude)).toEqual([1, 2, 3]);
  });

  it("retains a failed batch ahead of the steady-state cap", () => {
    const full = Array.from({ length: LOCATION_BUFFER_CAP }, (_, index) => sample(index));
    const merged = mergeFailed(full, [sample(-1)]);
    expect(merged).toHaveLength(LOCATION_BUFFER_CAP + 1);
    expect(merged[0]?.latitude).toBe(-1);
    expect(pushSample(merged, sample(99))).toHaveLength(LOCATION_BUFFER_CAP);
  });
});

