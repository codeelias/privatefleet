/**
 * Completion gate decision (docs/54 R3) - PURE logic, no DB, no HTTP.
 * Unit-tested in completion-gate.test.ts; the thin DB runner lives in
 * pg-service.ts (fleet module owns both).
 *
 * Accuracy-aware and staleness-aware (Onfleet model):
 * - a fix coarser than the radius never blocks,
 * - a missing or stale fix never blocks,
 * - the gate is disabled entirely unless the policy sets a radius.
 */
export interface GatePolicy {
  radiusM: number | null;
  mode: "warn" | "block";
}

export interface GateFix {
  latitude: number | null;
  longitude: number | null;
  capturedAt: string | Date | null;
  accuracyMetres: number | null;
}

export type GateDecision =
  | { action: "allow" }
  | { action: "skip"; reason: "no_fix" | "stale_fix" | "poor_accuracy" }
  | { action: "warn"; distanceMetres: number }
  | { action: "block"; distanceMetres: number };

export const GATE_FIX_MAX_AGE_MS = 5 * 60_000;

export function evaluateCompletionGate(
  policy: GatePolicy,
  fix: GateFix,
  stop: { latitude: number; longitude: number },
  nowMs: number,
): GateDecision {
  const radius = policy.radiusM;
  if (!radius || radius <= 0) return { action: "allow" };

  if (fix.latitude === null || fix.longitude === null || !fix.capturedAt) {
    return { action: "skip", reason: "no_fix" };
  }
  const capturedMs = typeof fix.capturedAt === "string"
    ? Date.parse(fix.capturedAt)
    : fix.capturedAt.getTime();
  if (nowMs - capturedMs > GATE_FIX_MAX_AGE_MS) {
    return { action: "skip", reason: "stale_fix" };
  }
  if (fix.accuracyMetres !== null && fix.accuracyMetres > radius) {
    return { action: "skip", reason: "poor_accuracy" };
  }
  const distance = haversineMetres(
    stop.latitude, stop.longitude, fix.latitude, fix.longitude,
  );
  if (distance <= radius) return { action: "allow" };
  if (policy.mode === "block") return { action: "block", distanceMetres: Math.round(distance) };
  return { action: "warn", distanceMetres: Math.round(distance) };
}

/** Great-circle distance in metres between two WGS-84 points. */
export function haversineMetres(
  latA: number, lngA: number, latB: number, lngB: number,
): number {
  const rad = Math.PI / 180;
  const dLat = (latB - latA) * rad;
  const dLng = (lngB - lngA) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA * rad) * Math.cos(latB * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
