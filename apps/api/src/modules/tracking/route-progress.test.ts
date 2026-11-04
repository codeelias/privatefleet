import { describe, expect, it } from "vitest";
import { computeLiveProgress, cumulative, project, type GeoPoint } from "./route-progress.js";

const line: GeoPoint[] = [
  { latitude: 51.5, longitude: -0.1 },
  { latitude: 51.5, longitude: -0.11 },
  { latitude: 51.51, longitude: -0.11 },
];

describe("route progress", () => {
  it("projects a position onto the polyline", () => {
    const cum = cumulative(line);
    const along = project(51.5, -0.105, line, cum);
    const segmentMetres = 111_320 * Math.cos((Math.PI / 180) * 51.5) * 0.01;
    expect(Math.abs(along - segmentMetres / 2)).toBeLessThan(5);
  });

  it("computes stops-away and ETA minutes from live position", () => {
    const result = computeLiveProgress(line, 51.5, -0.1, 51.51, -0.11, 2, 7);
    expect(result).not.toBeNull();
    expect(result?.stopsAway).toBe(2);
    // Total line length at 7 m/s -> minutes, rounded up.
    const total = cumulative(line)[2] ?? 0;
    expect(result?.etaMinutes).toBe(Math.ceil(total / 7 / 60));
  });

  it("returns null without a usable polyline", () => {
    expect(computeLiveProgress([], 51.5, -0.1, 51.51, -0.11, 0, 7)).toBeNull();
  });

  it("clamps absurd speeds to the default cruise speed", () => {
    const fast = computeLiveProgress(line, 51.5, -0.1, 51.51, -0.11, 0, 400);
    const normal = computeLiveProgress(line, 51.5, -0.1, 51.51, -0.11, 0, 7);
    expect(fast?.etaMinutes).toBe(normal?.etaMinutes);
  });
});
