# 60 - Product-level audit: can PrivateFleet demonstrate three owner benefits?

Date: 2026-11-08. Scope: evaluation only - no feature work. Purpose: assess,
with evidence, whether the product can now answer the three owner questions,
and how that experience compares with existing fleet software. This audit
deliberately does NOT establish commercial validation: a synthetic
demonstration proves technical capability, never willingness to pay.

## Method

Every claim below is tied to an executable, reproducible artefact:

- the live demonstration run (2026-11-08, production, timestamped log),
- `scripts/p1-demo-120s.ts` (deterministic driver),
- the preserved evidence report `artifacts/p1-demo/demo-evidence-report.pdf`,
- the derived-outcome and episode-resolution endpoints,
- docs/54 competitive research reconciliation (prior, evidence-based).

## Question 1: Which customer commitments were threatened?

Answer, with evidence: the product answers this per stop, from LIVE data only,
and refuses to guess.

- Detection is rules-based over fresh telemetry + the active plan: the demo's
  dropoff window was committed, the plan's arrival was after the window, and
  fresh telemetry produced ONE explainable episode
  (`threat_class=planned_breach`, reasons recorded).
- Stale data is never scored: stale GPS and stale plans produced no episode
  (negative tests 1-2); repeated telemetry never duplicated the episode
  (negative 3).
- The unit of value is a kept or honestly-reported commitment; the threat
  record names the scope (stop) and the class - an owner can say WHICH
  commitment was at risk and WHY.

Honest limits: risk is per-driver-plan; a job outside any active plan is not
scored (no invented coverage). Timing classes are timing_unverified without
independent handover evidence - the product refuses to fabricate on-time/late
verdicts.

## Question 2: What did the dispatcher do, and what happened?

Answer, with evidence: the append-only record answers both halves separately -
an attempt is never shown as an outcome.

- Every dispatcher action is a typed event with actor, time, and stage:
  contact_driver attempt -> contact_driver confirmed (outcome=failed) ->
  reassign (referencing the canonical assignment event) -> reschedule
  (revision, original preserved) -> notify_customer attempt.
- Derived resolution follows the THREAT, not the actions: after a failed
  contact the state was response_failed; after the stop completed and the
  engine observed two consecutive clears, the episode resolved
  (threat_cleared). Actions alone can never resolve an episode.
- The completion was evidence-gated: refused (422 EVIDENCE_REQUIRED) until
  photo + signature + recipient existed, then accepted.

Honest limits: v1 records a reassignment as a response correlated to the
canonical assignment event. The assign workflow itself only handles initial
assignment, so **driver reassignment of an already-assigned job is NOT an
operational capability yet**: a response.reassign event does NOT mean a job
was successfully transferred. Do not demonstrate reassignment as completed.
Also, the risk engine covers commitments on active driver plans - it does not
cover every outstanding job; the defensible claim is "identifies threats to
eligible, actively planned delivery commitments using fresh operational
data", not universal commitment monitoring.

## Question 3: Can the owner independently reconstruct the entire incident
from the evidence report?

Answer, with evidence: yes, from the record alone - the report is generated
from the append-only history and re-verifies the evidence files at generation
time. Terminology note (review-qualified): this is **integrity-checked
reconstruction**, not integrity-proven reconstruction - hash verification
establishes that stored files match their recorded hashes; it does NOT
independently establish the authenticity of the original handover, the
recipient's declared identity, or that the original evidence was authentic.

- The PDF contains: job + driver, per-stop windows and derived outcomes
  (operational, timing, evidence completeness, original vs revised), every
  evidence item with device capture time, server receipt time, size, sha256,
  and a per-file integrity verdict computed by re-hashing the stored bytes
  against the recorded hash (demo: verified,verified).
- Exception history is included: the episode (threat class, level, opened
  time, lifecycle status, derived resolution) and every response event in
  order with actor and stage/outcome.
- The timeline distinguishes capture (device) from receipt (server) and
  reports timing_unverified where no independent handover evidence exists -
  the reconstruction is complete precisely because it refuses to invent.

## Comparison with existing fleet software (docs/54 basis)

This comparison is a **differentiation hypothesis**, scoped to the specific
products and capabilities examined in docs/54 - NOT an established
market-wide advantage. It does not claim that existing fleet software in
general lacks integrity verification or commitment-risk functionality.

| Experience | Generic telematics/stops tools | PrivateFleet v1 |
|---|---|---|
| Know which commitment is threatened | List of stops + arrival ETAs; no commitment-scoped threat identity | Per-stop explainable episodes, one active per threat, version-free identity |
| See what was done | Action logs exist, but attempts vs outcomes and actor/time discipline vary | Typed append-only events; attempt vs confirmed separated; request-hash idempotency |
| Resolution truth | Status fields, sometimes overwritten | Derived from the threat lifecycle (consecutive clears); actions never fake a resolution |
| Owner reconstruction | Export CSVs or screenshots (as examined in docs/54) | Printable report with per-file hash re-verification (integrity-checked) |
| Timing honesty | ETA vs actual from device timestamps | timing_unverified unless independent handover evidence exists |

Positioning (docs/56, frozen): "Every delivery has a commitment. Every
exception gets an accountable response. Every completion has evidence."

## What this audit does NOT establish

1. Customer willingness to pay - the demonstration is synthetic; nothing here
   measures demand, price tolerance, or willingness to switch.
2. Differentiation in the market - the comparison above is capability-based
   and drawn from prior research; it has not been tested with real buyers.
3. Production resilience claims beyond the evidence - single device for
   driver flows (P0.2 open), encrypted-archive restoration drill pending
   (P0.3), and live positive episode creation has been demonstrated only via
   the synthetic tenant, not from real operations.

## Recommendation (no scope expansion)

The next step is validation, not development: show the three owner questions
with the preserved demo artefact and the live log to at least one real
dispatcher and one real owner, and record what convinces them and what does
not. P0.2 and P0.3 remain tracked independently.
