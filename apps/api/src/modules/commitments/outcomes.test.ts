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
  it("a failed initial attempt never blocks a subsequent successful recovery", () => {
    // Reviewer sequence: contact failed -> reassign confirmed -> evidence resolved.
    const resolution = deriveExceptionResolution(
      { status: "open" },
      [
        event({ id: "f1", stage: "confirmed", outcome: "failed" }, "2026-11-08T10:00:00.000Z"),
        event({ id: "r1", stage: "confirmed", outcome: "resolved", resolutionNote: "new driver progressing" }, "2026-11-08T10:30:00.000Z"),
      ],
    );
    expect(resolution.state).toBe("resolved");
    expect(resolution.basis).toBe("evidence");
    expect(resolution.resolutionNote).toBe("new driver progressing");
    // The failed event itself stays in the append-only store (history is
    // never mutated - the store keeps every event; see response-actions tests).
  });

  it("a failed outcome with no later success can never derive resolved", () => {
    const resolution = deriveExceptionResolution(
      { status: "open" },
      [event({ stage: "confirmed", outcome: "failed" })],
    );
    expect(resolution.state).toBe("response_failed");
  });

  it("a later failed action never revokes an established recovery", () => {
    // Failed customer notification AFTER a successful reassignment: the
    // resolution stands; the failed action is preserved in the timeline.
    const resolution = deriveExceptionResolution(
      { status: "open" },
      [
        event({ stage: "confirmed", outcome: "resolved" }, "2026-11-08T10:00:00.000Z"),
        event({ stage: "confirmed", outcome: "failed" }, "2026-11-08T10:30:00.000Z"),
      ],
    );
    expect(resolution.state).toBe("resolved");
  });

  it("episode-level resolved (threat cleared) dominates; closed never implies recovery", () => {
    expect(deriveExceptionResolution({ status: "resolved", resolutionNote: "threat_cleared" }, []).state).toBe("resolved");
    const closed = deriveExceptionResolution({ status: "closed", closeReason: "duplicate" }, [event({ stage: "confirmed", outcome: "resolved" })]);
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
    handoverBracket: { start: "2026-11-08T10:00:00.000Z", end: "2026-11-08T10:00:30.000Z" },
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

  it("a device timestamp alone can NEVER verify timing - corroboration required", () => {
    expect(deriveCommitmentOutcome({ ...base, handoverBracket: null }).timing).toBe("timing_unverified");
    expect(deriveCommitmentOutcome({ ...base, handoverBracket: null }).timing).toBe("timing_unverified");
  });

  it("early and late require an independent server-clock bracket outside the window", () => {
    expect(deriveCommitmentOutcome({
      ...base, handoverBracket: { start: "2026-11-08T08:30:00.000Z", end: "2026-11-08T08:30:30.000Z" },
    }).timing).toBe("early");
    expect(deriveCommitmentOutcome({
      ...base, handoverBracket: { start: "2026-11-08T12:00:00.000Z", end: "2026-11-08T12:00:30.000Z" },
    }).timing).toBe("late");
  });

  it("a bracket straddling a window boundary is timing_unverified, never guessed", () => {
    expect(deriveCommitmentOutcome({
      ...base, handoverBracket: { start: "2026-11-08T08:59:00.000Z", end: "2026-11-08T09:30:00.000Z" },
    }).timing).toBe("timing_unverified");
    expect(deriveCommitmentOutcome({
      ...base, handoverBracket: { start: "2026-11-08T10:59:00.000Z", end: "2026-11-08T11:30:00.000Z" },
    }).timing).toBe("timing_unverified");
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
      handoverBracket: { start: "2026-11-08T11:30:00.000Z", end: "2026-11-08T11:30:30.000Z" }, // late against the ORIGINAL window
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
    // A resolved exception changes NOTHING about a failed stop.
    const resolution = deriveExceptionResolution({ status: "open" }, [event({ stage: "confirmed", outcome: "resolved" })]);
    const outcome = deriveCommitmentOutcome({ ...base, status: "failed", evidenceKinds: [] });
    expect(resolution.state).toBe("resolved");
    expect(outcome.operational).toBe("not_delivered");
    expect(outcome.evidenceCompleteness).toBe("not_applicable");
  });
});


