/**
 * P1 slice 4 (docs/56 section 9): DERIVED resolution and commitment outcomes.
 * Pure functions over recorded facts. Nothing here writes, nothing here
 * duplicates a stored entity, and no outcome field exists in the database -
 * outcomes are computed from evidence at read time.
 *
 * Invariants enforced by construction and tested:
 *  - A failed response can never derive 'resolved'.
 *  - Exception resolution and delivery outcome are INDEPENDENT derivations:
 *    a resolved exception never changes a stop's operational outcome.
 *  - Original and revised commitment results are preserved independently.
 *  - Operational completion, timing and evidence completeness are separate
 *    dimensions (docs/56: three orthogonal outcome dimensions).
 *  - Timing 'verified' requires captured evidence time; server receipt is
 *    never silently used as a delivery time.
 */
import type { ResponseEventRow } from "./response-actions.js";

export interface EpisodeFacts {
  status: string;
  closeReason?: string | null;
  resolutionNote?: string | null;
}

export type DerivedResolutionState =
  | "open"
  | "investigating"
  | "response_in_progress"
  | "response_failed"
  | "resolved"
  | "closed";

export interface DerivedResolution {
  state: DerivedResolutionState;
  closedReason?: string | undefined;
  resolutionNote?: string | undefined;
  basis: "episode" | "evidence" | "none";
}

/**
 * Exception resolution, derived from the episode lifecycle AND the recorded
 * response evidence. 'resolved' requires evidence: either the episode itself
 * resolved (consecutive-clear evidence) or a CONFIRMED response event whose
 * recorded outcome is 'resolved'. A confirmed 'failed' outcome pins the
 * derived state to response_failed - never resolved. 'closed' (duplicate/
 * invalidated/superseded) is reported as closed and never as recovery.
 */
export function deriveExceptionResolution(
  episode: EpisodeFacts,
  events: ResponseEventRow[],
): DerivedResolution {
  if (episode.status === "closed") {
    return {
      state: "closed",
      closedReason: episode.closeReason ?? undefined,
      basis: "none",
    };
  }
  if (episode.status === "resolved") {
    return {
      state: "resolved",
      resolutionNote: episode.resolutionNote ?? undefined,
      basis: "episode",
    };
  }
  const confirmed = events.filter(
    (event) => (event.payload as { stage?: string }).stage === "confirmed",
  );
  const resolvedEvidence = confirmed.filter(
    (event) => (event.payload as { outcome?: string }).outcome === "resolved",
  );
  const failedEvidence = confirmed.filter(
    (event) => (event.payload as { outcome?: string }).outcome === "failed",
  );
  // A confirmed recovery RESOLVES the episode and the resolution stands:
  // later failed actions (for example a failed customer notification after a
  // successful reassignment) are preserved in the timeline but never revoke
  // an established recovery. A failed outcome matters only when there is NO
  // successful recovery evidence at all.
  if (resolvedEvidence.length > 0) {
    const latestResolved = [...resolvedEvidence].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )[0];
    return {
      state: "resolved",
      resolutionNote:
        (latestResolved?.payload as { resolutionNote?: string } | undefined)?.resolutionNote ?? undefined,
      basis: "evidence",
    };
  }
  if (failedEvidence.length > 0) {
    return { state: "response_failed", basis: "evidence" };
  }
  if (confirmed.length > 0) {
    return { state: "response_in_progress", basis: "none" };
  }
  const attempts = events.filter(
    (event) => (event.payload as { stage?: string }).stage === "attempt",
  );
  if (attempts.length > 0) {
    return { state: "investigating", basis: "none" };
  }
  return { state: "open", basis: "none" };
}

export interface CommitmentStopFacts {
  status: string;
  jobCancelled: boolean;
  /**
   * Independent handover evidence (docs/56): a SERVER-clock bracket from
   * records other than the device-reported timestamp - the receipt time of a
   * position fix within the completion radius (server clock) and the receipt
   * time of the completion evidence (server clock). Device and server
   * timestamps being close together proves only that RECORDS arrived close
   * together, never when the physical handover occurred - so null (no
   * independent bracket) always yields timing_unverified.
   */
  handoverBracket: { start: string; end: string } | null;
  windowStart: string;
  windowEnd: string;
  evidenceKinds: string[];
  requiredEvidenceKinds: string[];
  revisions: Array<{
    windowStart: string;
    windowEnd: string;
    effectiveAt: string | null;
  }>;
}

export type OperationalOutcome = "completed" | "not_delivered" | "cancelled" | "unconfirmed";
export type TimingOutcome = "early" | "within_window" | "late" | "timing_unverified" | "not_applicable";
export type EvidenceCompleteness = "complete" | "incomplete" | "not_applicable";

export interface DerivedCommitmentOutcome {
  operational: OperationalOutcome;
  timing: TimingOutcome;
  evidenceCompleteness: EvidenceCompleteness;
  originalTiming: TimingOutcome;
  revisedTiming: TimingOutcome | "not_applicable";
}

/**
 * Timing requires an independently corroborated handover bracket: BOTH ends
 * are server-clock records (position-fix receipt + evidence receipt). A
 * timing class is asserted only when the whole bracket agrees; any straddle
 * or a missing bracket returns timing_unverified.
 */
function timingOf(
  bracket: { start: string; end: string } | null,
  windowStart: string,
  windowEnd: string,
): TimingOutcome {
  if (bracket == null) return "timing_unverified";
  const lower = new Date(bracket.start).getTime();
  const upper = new Date(bracket.end).getTime();
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  if (upper < start) return "early";
  if (lower > end) return "late";
  if (lower >= start && upper <= end) return "within_window";
  return "timing_unverified"; // straddles a boundary: not corroborated
}

/**
 * Commitment outcome for one stop, derived on three orthogonal dimensions.
 * Revisions (confirmed reschedules with effective times) never overwrite the
 * original window result - both are reported.
 */
export function deriveCommitmentOutcome(stop: CommitmentStopFacts): DerivedCommitmentOutcome {
  const operational: OperationalOutcome =
    stop.jobCancelled
      ? "cancelled"
      : stop.status === "completed"
        ? "completed"
        : stop.status === "failed"
          ? "not_delivered"
          : "unconfirmed"; // pending/arrived/skipped: no accepted completion, not terminal

  const completed = operational === "completed";
  const originalTiming: TimingOutcome = completed
    ? timingOf(stop.handoverBracket, stop.windowStart, stop.windowEnd)
    : "not_applicable";

  let revisedTiming: TimingOutcome | "not_applicable" = "not_applicable";
  if (completed && stop.handoverBracket != null && stop.revisions.length > 0) {
    // Latest revision whose effective time is not after the completion time.
    const t = new Date(stop.handoverBracket.end).getTime();
    const applicable = stop.revisions.filter(
      (revision) => revision.effectiveAt == null || new Date(revision.effectiveAt).getTime() <= t,
    );
    if (applicable.length > 0) {
      const latest = applicable[applicable.length - 1];
      if (latest) {
        revisedTiming = timingOf(stop.handoverBracket, latest.windowStart, latest.windowEnd);
      }
    }
  }

  const evidenceCompleteness: EvidenceCompleteness = !completed
    ? "not_applicable"
    : stop.requiredEvidenceKinds.every((kind) => stop.evidenceKinds.includes(kind))
      ? "complete"
      : "incomplete";

  return {
    operational,
    timing: originalTiming,
    evidenceCompleteness,
    originalTiming,
    revisedTiming,
  };
}
