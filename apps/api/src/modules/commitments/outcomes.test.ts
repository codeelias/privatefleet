/**
 * Slice 4 invariants: derived-only outcomes, failed-never-resolved, original
 * vs revised preserved, three orthogonal dimensions, and the decoupling of
 * exception resolution from delivery outcome.
 */
import { describe, expect, it } from "vitest";
import { deriveCommitmentOutcome, deriveExceptionResolution } from "./outcomes.js";
import type { ResponseEventRow } from "./response-actions.js";

function event(payload: Record<string, unknown>, occurredAt?: string): ResponseEventRow {
  return {
    id: payload.id as string ?? "e1",
    episodeId: "ep1",
    type: "response.other",
    actorId: "a1",
    payload,
    occurredAt: occurredAt ?? new Date(0).toISOString(),
  };
}

describe("deriveExceptionResolution", () => {
  it("the reviewer sequence resolves ONLY when the threat actually clears", () => {
    // Contact failed -> reassign confirmed -> threat cleared (consecutive
    // clears) -> episode status resolved. Resolution comes from the threat
    // condition, not from the response events.
    const resolution = deriveExceptionResolution(
      { status: "resolved", resolutionNote: "threat_cleared" },
      [
        event({ id: "f1", stage: "confirmed", outcome: "failed" }, "2026-11-08T10:00:00.000Z"),
        event({ id: "r1", stage: "confirmed", outcome: "resolved" }, "2026-11-08T10:30:00.000Z"),
      ],
    );
    expect(resolution.state).toBe("resolved");
    expect(resolution.basis).toBe("episode");
    // The failed event itself stays in the append-only store (never mutated).
  });

  it("a confirmed reassignment NEVER resolves an active threat", () => {
    // Reassignment confirmed, new driver makes NO progress, original threat
    // still active (episode open). Resolution must require evidence that the
    // actual threat cleared - a successful action alone is not it.
    const resolution = deriveExceptionResolution(
      { status: "open" },
      [event({ stage: "confirmed", outcome: "resolved", note: "reassigned" })],
    );
    expect(resolution.state).not.toBe("resolved");
    expect(resolution.state).toBe("response_in_progress");
  });

  it("a later failed action never revokes an established (threat-cleared) resolution", () => {
    const resolution = deriveExceptionResolution(
      { status: "resolved", resolutionNote: "threat_cleared" },
      [
        event({ stage: "confirmed", outcome: "resolved" }, "2026-11-08T10:00:00.000Z"),
        event({ stage: "confirmed", outcome: "failed" }, "2026-11-08T10:30:00.000Z"),
      ],
    );
    expect(resolution.state).toBe("resolved");
  });

  it("a failed outcome with the threat still active can never derive resolved", () => {
    const resolution = deriveExceptionResolution(
      { status: "open" },
      [event({ stage: "confirmed", outcome: "failed" })],
    );
    expect(resolution.state).toBe("response_failed");
  });

  it("closed never implies recovery", () => {
    const closed = deriveExceptionResolution(
      { status: "closed", closeReason: "duplicate" },
      [event({ stage: "confirmed", outcome: "resolved" })],
    );
    expect(closed.state).toBe("closed");
    expect(closed.closedReason).toBe("duplicate");
  });

  it("active episodes progress open -> investigating -> response_in_progress", () => {
    expect(deriveExceptionResolution({ status: "open" }, []).state).toBe("open");
    expect(deriveExceptionResolution({ status: "open" }, [event({ stage: "attempt" })]).state).toBe("investigating");
    expect(deriveExceptionResolution({ status: "open" }, [event({ stage: "confirmed" })]).state).toBe("response_in_progress");
  });
});

describe("deriveCommitmentOutcome", () => {
  const base = {
    status: "completed",
    jobCancelled: false,
    independentHandoverTime: "2026-11-08T10:00:00.000Z",
    windowStart: "2026-11-08T09:00:00.000Z",
    windowEnd: "2026-11-08T11:00:00.000Z",
    evidenceKinds: ["photo"],
    requiredEvidenceKinds: ["photo"],
    revisions: [],
  };

  it("three orthogonal dimensions: completion, timing, evidence", () => {
    const outcome = deriveCommitmentOutcome(base);
    expect(outcome.operational).toBe("completed");
    expect(outcome.timing).toBe("within_window");
    expect(outcome.evidenceCompleteness).toBe("complete");
  });

  it("without independent handover-time evidence, timing is ALWAYS unverified", () => {
    expect(deriveCommitmentOutcome({ ...base, independentHandoverTime: null }).timing).toBe("timing_unverified");
  });

  it("an explicitly supplied independent handover time classifies directly", () => {
    expect(deriveCommitmentOutcome({
      ...base, independentHandoverTime: "2026-11-08T08:30:00.000Z",
    }).timing).toBe("early");
    expect(deriveCommitmentOutcome({
      ...base, independentHandoverTime: "2026-11-08T12:00:00.000Z",
    }).timing).toBe("late");
    expect(deriveCommitmentOutcome({
      ...base, independentHandoverTime: "2026-11-08T10:00:00.000Z",
    }).timing).toBe("within_window");
  });

  it("offline-queued evidence (captured before the fix, uploaded after) is unverified", () => {
    // Evidence captured 09:50 on the device, uploaded 10:30; a position fix
    // was received by the server at 10:25; window 09:00-10:00. A naive
    // bracket [fix receipt, upload receipt] = [10:25, 10:30] would wrongly
    // say 'late': the fix proves only PRESENCE and the receipt only
    // RECEPTION - neither attests the physical handover at 09:50. The
    // derivation receives no independent handover time and must report
    // timing_unverified.
    const outcome = deriveCommitmentOutcome({ ...base, independentHandoverTime: null });
    expect(outcome.timing).toBe("timing_unverified");
  });

  it("skipped is unconfirmed, not terminal not_delivered; failed is not_delivered; cancelled is cancelled", () => {
    expect(deriveCommitmentOutcome({ ...base, status: "skipped" }).operational).toBe("unconfirmed");
    expect(deriveCommitmentOutcome({ ...base, status: "failed" }).operational).toBe("not_delivered");
    expect(deriveCommitmentOutcome({ ...base, jobCancelled: true }).operational).toBe("cancelled");
    expect(deriveCommitmentOutcome({ ...base, status: "skipped" }).timing).toBe("not_applicable");
  });

  it("incomplete evidence is reported, never masked", () => {
    const outcome = deriveCommitmentOutcome({ ...base, evidenceKinds: [] });
    expect(outcome.evidenceCompleteness).toBe("incomplete");
  });

  it("original and revised results are preserved independently", () => {
    const outcome = deriveCommitmentOutcome({
      ...base,
      independentHandoverTime: "2026-11-08T11:30:00.000Z", // late against the ORIGINAL window
      revisions: [
        {
          windowStart: "2026-11-08T11:00:00.000Z",
          windowEnd: "2026-11-08T12:00:00.000Z",
          effectiveAt: "2026-11-08T08:00:00.000Z",
        },
      ],
    });
    expect(outcome.originalTiming).toBe("late");
    expect(outcome.revisedTiming).toBe("within_window");
  });

  it("exception resolution and delivery outcome are independent", () => {
    // A resolved exception (threat actually cleared) changes NOTHING about a
    // failed stop's operational outcome.
    const resolution = deriveExceptionResolution(
      { status: "resolved", resolutionNote: "threat_cleared" },
      [event({ stage: "confirmed", outcome: "resolved" })],
    );
    const outcome = deriveCommitmentOutcome({ ...base, status: "failed", evidenceKinds: [] });
    expect(resolution.state).toBe("resolved");
    expect(outcome.operational).toBe("not_delivered");
    expect(outcome.evidenceCompleteness).toBe("not_applicable");
  });
});



