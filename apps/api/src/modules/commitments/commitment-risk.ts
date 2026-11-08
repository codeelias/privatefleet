/**
 * Commitment Risk Engine (docs/56, P1 slice 1) - PURE logic, no DB, no HTTP.
 * Unit-tested in commitment-risk.test.ts.
 *
 * Honesty rules carried over from the frozen product definition and the
 * existing stop-risk module:
 * - terminal stops are never scored;
 * - a stale plan (planned arrival already past) is never scored;
 * - a stale or missing fix is never scored (stale GPS is not live GPS);
 * - "stationary" is only a threat when it coincides with a diminishing
 *   window margin and insufficient progress - waiting is working;
 * - the fingerprint is scope + threat class ONLY: plan version is
 *   provenance, never threat identity (episode dedup per docs/56).
 */
export type ThreatClass =
  | "planned_breach"
  | "window_pressure"
  | "stationary_diminishing_margin";

export type RiskAssessment =
  | { kind: "none"; reasons: string[] }
  | {
      kind: "threat";
      scope: "stop";
      scopeId: string;
      threatClass: ThreatClass;
      level: "late" | "at_risk";
      reasons: string[];
      fingerprint: string;
    };

export const STALE_FIX_MS = 60_000; // matches the fleet stale threshold
export const STATIONARY_THREAT_MS = 18 * 60_000; // demo: stationary 18 min
export const WINDOW_PRESSURE_MS = 15 * 60_000; // window closes within 15 min
export const MARGIN_THREAT_MS = 30 * 60_000; // margin small enough that waiting threatens the commitment

export interface CommitmentRiskInput {
  nowMs: number;
  stopId: string;
  stopStatus: string;
  windowStart: Date | string | null;
  windowEnd: Date | string | null;
  plannedArrivalAt: Date | string | null;
  fixCapturedAt: Date | string | null;
  fixAccuracyMetres: number | null;
  stationarySinceMs: number | null;
}

function ms(value: Date | string | null): number | null {
  if (value === null) return null;
  return typeof value === "string" ? Date.parse(value) : value.getTime();
}

export function assessCommitmentRisk(input: CommitmentRiskInput): RiskAssessment {
  const reasons: string[] = [];
  if (
    input.stopStatus === "completed" ||
    input.stopStatus === "skipped" ||
    input.stopStatus === "failed"
  ) {
    return { kind: "none", reasons: [] }; // terminal: nothing to protect
  }
  const windowEnd = ms(input.windowEnd);
  if (windowEnd === null) {
    return { kind: "none", reasons: ["no committed window"] };
  }
  const planned = ms(input.plannedArrivalAt);
  if (planned === null) {
    return { kind: "none", reasons: ["no effective plan"] };
  }
  if (!Number.isFinite(planned) || planned <= input.nowMs) {
    // A plan whose arrival is already past is stale, not risky.
    return { kind: "none", reasons: ["stale plan"] };
  }
  const fixAt = ms(input.fixCapturedAt);
  const fixFresh =
    fixAt !== null && Number.isFinite(fixAt) && input.nowMs - fixAt <= STALE_FIX_MS;

  if (planned > windowEnd) {
    reasons.push("planned arrival is after the committed window");
    return {
      kind: "threat",
      scope: "stop",
      scopeId: input.stopId,
      threatClass: "planned_breach",
      level: "late",
      reasons,
      fingerprint: `stop:${input.stopId}:planned_breach`,
    };
  }
  const marginMs = windowEnd - input.nowMs;
  if (marginMs <= WINDOW_PRESSURE_MS && input.stopStatus !== "arrived") {
    reasons.push(`window closes in ${Math.max(0, Math.round(marginMs / 60000))} min`);
    return {
      kind: "threat",
      scope: "stop",
      scopeId: input.stopId,
      threatClass: "window_pressure",
      level: "at_risk",
      reasons,
      fingerprint: `stop:${input.stopId}:window_pressure`,
    };
  }
  // Stationary is only a threat when a fresh fix proves the vehicle really is
  // stationary AND the remaining margin is thin: legitimate waiting (traffic,
  // collection, recipient) must never raise a false alarm.
  if (
    fixFresh &&
    input.stationarySinceMs !== null &&
    input.stationarySinceMs >= STATIONARY_THREAT_MS &&
    marginMs <= MARGIN_THREAT_MS
  ) {
    reasons.push(
      `stationary ${Math.round(input.stationarySinceMs / 60000)} min with ` +
        `${Math.round(marginMs / 60000)} min of window margin remaining`,
    );
    return {
      kind: "threat",
      scope: "stop",
      scopeId: input.stopId,
      threatClass: "stationary_diminishing_margin",
      level: "at_risk",
      reasons,
      fingerprint: `stop:${input.stopId}:stationary_diminishing_margin`,
    };
  }
  return { kind: "none", reasons: [] };
}
