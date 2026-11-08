# 59 - P1 Commitment Recovery v1: milestone closure

Date: 2026-11-08. Verdict: **ACCEPTED** by product review.

## Baseline (frozen, do not expand)

- HEAD: `c774474` (tag `p1-commitment-recovery-v1`)
- Gate at close: API 195/195 · web 53/53 · driver-native JUnit green.
- Live demo evidence: run log (see §59 record) + evidence-report PDF preserved at
  `artifacts/p1-demo/demo-evidence-report.pdf` (2,724 bytes, hash-verified
  integrity: verified,verified).
- Production counts at demo close: jobs=74, job_stops=146, stop_evidence=157;
  demo tenant reset to 0 rows.

## What shipped in P1 (slices 1-6)

1. Pure Commitment Risk Engine (stale plan/fix never scored; fingerprints are
   version-free identities).
2. Exception episode lifecycle (DB-enforced one-active-per-fingerprint;
   threat_cleared RESOLVES via consecutive clears; closed = duplicate/
   invalidated/superseded only; opening evidence preserved; telemetry runner
   fire-and-forget with logged failures).
3. Typed append-only response actions on job_events (attempt vs confirmed
   separated; request-hash idempotency with 409 on payload divergence;
   reassignment references the canonical assignment event).
4. Derived resolution + commitment outcomes (three orthogonal dimensions;
   response events NEVER resolve - only the threat clearing; timing always
   timing_unverified without independent handover evidence; original and
   revised commitments preserved independently).
5. Printable per-job evidence report (re-hashes stored files against recorded
   content hashes at report time; append-only history; dispatcher-only).
6. Synthetic 120-second demonstration + negative acceptance tests (all
   docs/56 positives 1-5 and negatives 1-7 executed; deterministic reset).

## Reviewer notes retained

- Terminal-stop correction: episodes now demonstrably clear after completion.
- Honest timing (timing_unverified) and honest notification (attempt, not
  delivered) approved as credibility behaviours.
- Synthetic demonstration establishes TECHNICAL capability only; commercial
  willingness to pay is NOT established. Next: product-level audit, no scope
  expansion.

## Open items (independently tracked, NOT closed by P1)

- P0.2 second device (owner-deferred).
- P0.3 encrypted-archive restoration drill (pending on the age-key machine).
- Commercial validation (not established).
