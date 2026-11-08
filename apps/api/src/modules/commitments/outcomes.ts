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
  const failedEvidence = confirmed.filter(
    (event) => (event.payload as { outcome?: string }).outcome === "failed",
  );
  // Response events NEVER resolve an episode. Resolution requires evidence
  // that the ACTUAL threat condition cleared - the episode lifecycle's
  // consecutive-clear rule (status 'resolved'). A confirmed reassignment, or
  // a response event recorded with outcome=resolved, proves only that an
  // action was taken: the threat itself must clear before 'resolved' can
  // ever be derived. Failed evidence merely presents the honest non-resolved
  // state response_failed.
  if (failedEvidence.length > 0) {
    return { state: "response_failed", basis: "none" };
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
   * Independent handover-time evidence (docs/56): a time that attests the
   * PHYSICAL handover from a source independent of the device clock and of
   * server receipt. A server-received position fix proves only device
   * PRESENCE; an evidence receipt proves only server RECEPTION - especially
   * with offline queues, neither establishes when the handover happened.
   * v1 has NO such independent source, so callers pass null and timing is
   * honestly timing_unverified until one is introduced.
   */
  independentHandoverTime: string | null;
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
 * Timing classification requires independently supported handover-time
 * evidence. Nothing currently recorded (device timestamps, server receipt
 * times, presence fixes) attests the physical handover time, so a missing
 * independent time always returns timing_unverified. If such a time is ever
 * supplied, it is classified against the window directly.
 */
function timingOf(
  independentHandoverTime: string | null,
  windowStart: string,
  windowEnd: string,
): TimingOutcome {
  if (independentHandoverTime == null) return "timing_unverified";
  const t = new Date(independentHandoverTime).getTime();
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  if (t < start) return "early";
  if (t > end) return "late";
  return "within_window";
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
    ? timingOf(stop.independentHandoverTime, stop.windowStart, stop.windowEnd)
    : "not_applicable";

  let revisedTiming: TimingOutcome | "not_applicable" = "not_applicable";
  if (completed && stop.independentHandoverTime != null && stop.revisions.length > 0) {
    // Latest revision whose effective time is not after the handover time.
    const t = new Date(stop.independentHandoverTime).getTime();
    const applicable = stop.revisions.filter(
      (revision) => revision.effectiveAt == null || new Date(revision.effectiveAt).getTime() <= t,
    );
    if (applicable.length > 0) {
      const latest = applicable[applicable.length - 1];
      if (latest) {
        revisedTiming = timingOf(stop.independentHandoverTime, latest.windowStart, latest.windowEnd);
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
