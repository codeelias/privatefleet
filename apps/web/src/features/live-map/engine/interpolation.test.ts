import { describe, expect, it } from "vitest";
import {
  isActive,
  positionAt,
  startTween,
  type Tween,
} from "./interpolation";

function tween(overrides: Partial<Tween> = {}): Tween {
  return {
    fromX: 0,
    fromY: 0,
    toX: 100,
    toY: 50,
    startedAt: 1_000,
    durationMs: 2_000,
    ...overrides,
  };
}

describe("marker interpolation", () => {
  it("moves monotonically from start to target and clamps at the end", () => {
    const value = tween();
    const atStart = positionAt(value, 1_000);
    expect(atStart).toEqual({ x: 0, y: 0 });
    const mid = positionAt(value, 2_000);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100);
    const late = positionAt(value, 3_000);
    expect(late).toEqual({ x: 100, y: 50 });
    // Bounded: never extrapolates beyond the target.
    expect(positionAt(value, 30_000)).toEqual({ x: 100, y: 50 });
  });

  it("retargets from the current animated position, not the old start", () => {
    const first = tween();
    const retarget = startTween(first, { x: 200, y: 100 }, 2_500, 1_000);
    expect(retarget.fromX).toBeGreaterThan(0);
    expect(retarget.fromX).toBeLessThan(100);
    expect(retarget.toX).toBe(200);
  });

  it("reports when motion is settled", () => {
    const value = tween();
    expect(isActive(value, 1_500)).toBe(true);
    expect(isActive(value, 3_000)).toBe(false);
    expect(isActive(tween({ durationMs: 0 }), 1_000)).toBe(false);
  });

  it("snaps instantly when duration is zero (reduced motion)", () => {
    const snapped = startTween(tween(), { x: 10, y: 20 }, 5_000, 0);
    expect(positionAt(snapped, 5_000)).toEqual({ x: 10, y: 20 });
  });
});
