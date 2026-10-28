/**
 * Timestamped marker interpolation (docs/17.3): animate between accepted
 * telemetry positions on a monotonic clock, clamp at the target (never
 * extrapolate indefinitely), and expose the active window so the canvas
 * loop can stop when everything has settled.
 */
export interface Tween {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  durationMs: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Start (or retarget) a tween from the current animated position. */
export function startTween(
  previous: Tween | undefined,
  target: Point,
  now: number,
  durationMs: number,
): Tween {
  const current = previous ? positionAt(previous, now) : target;
  return {
    fromX: current.x,
    fromY: current.y,
    toX: target.x,
    toY: target.y,
    startedAt: now,
    durationMs: Math.max(0, durationMs),
  };
}

/** Eased position at `now`, clamped to the target at/after the end. */
export function positionAt(tween: Tween, now: number): Point {
  if (tween.durationMs <= 0) {
    return { x: tween.toX, y: tween.toY };
  }
  const linear = Math.min(1, Math.max(0, (now - tween.startedAt) / tween.durationMs));
  // Smooth glide: ease-out cubic, no overshoot.
  const eased = 1 - Math.pow(1 - linear, 3);
  return {
    x: tween.fromX + (tween.toX - tween.fromX) * eased,
    y: tween.fromY + (tween.toY - tween.fromY) * eased,
  };
}

export function isActive(tween: Tween, now: number): boolean {
  return tween.durationMs > 0 && now < tween.startedAt + tween.durationMs;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
