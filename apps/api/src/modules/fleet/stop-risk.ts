/**
 * At-risk scoring (docs/54 R10) - PURE logic, unit-tested in
 * stop-risk.test.ts. Display-only: it flags, it never blocks.
 *
 * Rules (documented, honest):
 * - terminal stops (completed/skipped/failed) carry no risk;
 * - no plan -> unknown;
 * - planned arrival after the window end -> late;
 * - window closes within 15 minutes -> at_risk;
 * - otherwise -> on_track.
 */
export type StopRisk = "late" | "at_risk" | "on_track" | "unknown";

export const AT_RISK_WINDOW_MS = 15 * 60_000;

export function stopRisk(input: {
  status: string;
  plannedArrivalAt: Date | string | null | undefined;
  windowEnd: Date | string | null | undefined;
  nowMs: number;
}): StopRisk | undefined {
  if (
    input.status === "completed" ||
    input.status === "skipped" ||
    input.status === "failed"
  ) {
    return undefined;
  }
  if (!input.plannedArrivalAt) return "unknown";
  const planned = typeof input.plannedArrivalAt === "string"
    ? Date.parse(input.plannedArrivalAt)
    : input.plannedArrivalAt.getTime();
  if (!Number.isFinite(planned)) return "unknown";
  // A plan whose arrival time is already in the past is STALE, not risky -
  // never flag historical data as a live problem (false positive).
  if (planned <= input.nowMs) return "unknown";
  const window = input.windowEnd
    ? (typeof input.windowEnd === "string"
        ? Date.parse(input.windowEnd)
        : input.windowEnd.getTime())
    : null;
  if (window !== null && Number.isFinite(window) && window <= input.nowMs) {
    return "unknown"; // the promised window has already closed: stale context
  }
  if (window !== null && Number.isFinite(window) && planned > window) {
    return "late";
  }
  if (window !== null && Number.isFinite(window) && window - input.nowMs <= AT_RISK_WINDOW_MS) {
    return "at_risk";
  }
  return "on_track";
}
