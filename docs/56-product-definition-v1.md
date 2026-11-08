# 56 - Product Definition v1

Drafted: 2026-11-08. Status: DRAFT for review — not yet frozen as product authority.
This document defines PrivateFleet v1. It is deliberately a PRODUCT definition,
not an implementation specification: it states behaviour, invariants, scope and
acceptance criteria, and it does not prescribe migrations or schema.

## 1. Product identity

**PrivateFleet v1 is an operational-reliability product whose unit of value is
a kept, saved, or honestly reported customer commitment.**

Core product philosophy:

> Every delivery has a commitment.
> Every exception gets an accountable response.
> Every completion has evidence.

PrivateFleet is not positioned as an AI-powered fleet platform. Differentiation
comes from the workflow, the integrity of its records, and the usefulness of
its operational decisions — not from feature count.

## 2. Target market

London-based specialist B2B delivery operators handling:

- scheduled and urgent deliveries,
- strict delivery windows,
- multiple business customers,
- evidence-sensitive handovers.

Explicitly EXCLUDED from v1 product claims (not permanent restrictions, but
out of scope until proven): passenger/patient transport, temperature-controlled
medicines, regulated clinical specimen transport, and any processing of special-
category health data.

## 3. Customer personas

| Persona | Role | What the product must give them |
|---|---|---|
| Owner / Managing Director / Operations Director | Economic buyer | Service reliability, accountability, financial visibility; the answer to "which commitment almost failed, what did we do, did it work, can I prove it" |
| Dispatcher | Operational champion, primary daily user | Fewer unresolved operational problems; risk triage that says which two things to touch first |
| Driver | Field user | Today's jobs, next job, navigation, collection/delivery, evidence capture, report-a-problem — and nothing more |

The dispatcher experience demonstrates the product. The owner experience
justifies purchasing it.

## 4. Operational philosophy

The system's unit of value is the customer commitment, not the vehicle or the
route. The operating loop:

```text
COMMITMENT  The promise is recorded and live.
THREAT      The system sees the promise slipping before the operator does.
DECISION    The dispatcher gets one clear, explainable, actionable case.
ACTION      A human chooses; the choice is recorded, attributed, reversible.
OUTCOME     The response succeeds or fails — and the system says which, truthfully.
PROOF       The completion carries a defensible evidence chain.
ACCOUNT     The owner sees promise, threat, action, outcome and proof, per
            customer, without asking anyone.
```

## 5. Four capabilities

| Capability | What it means in v1 |
|---|---|
| SLA Protection | Explainable, rules-based risk derived from live data only. `Operational Risk = f(Commitment, ETA, Progress, Telemetry, Delay)`. Stale plans and stale fixes are never scored (R10 protections reused, not duplicated). |
| Exception Response (Recovery Centre) | A detected threat becomes an actionable episode; responses are recorded with outcomes. The system helps operators respond, not merely report. |
| Verifiable Handover & Evidence | A chain of custody, not a file: capture time vs server receipt time, device location and accuracy, content-integrity verification, recipient-declared information, driver identity, recorded corrections. |
| Accountability & Performance | Per-customer on-time performance, failures, reattempts, exception causes, evidence completeness — and later, billing-readiness (billable jobs, charges, unbilled work). Built AFTER the operational loop is proven (P3). |

## 6. Trust model

Five guarantees. Trust is demonstrated behaviour under failure, never claimed
architecture:

| Guarantee | Meaning | Validation required |
|---|---|---|
| Location integrity | Freshness and accuracy are displayed; stale GPS is never presented as live | Containment-invariant position hold (property-tested), lifecycle states, stale-plan guards |
| Evidence integrity | Original events preserved; corrections recorded as new events; files served only after hash verification | Content-hash check before serving (live-verified); tamper test in suite |
| Offline reliability | Jobs complete without connectivity; evidence synchronises without duplication | Command queue + idempotent sync; second device validation (P0, not yet done) |
| Data security | Tenant isolation, scoped tokens, least exposure | RLS everywhere; hashed tracking tokens; no personal data on public pages |
| Operational transparency | Clear status, failure reasons, timestamps, responsibility for every exception | Honest statuses across product; negative acceptance tests |

An additional trust exercise is required and not yet performed: **an actual
database backup restoration drill** (a backup without a tested restore is not
a backup). Claiming certifications we do not hold is forbidden.

## 7. Commitment model

- The original customer commitment for v1 is per-job: the committed delivery
  window, applicable service requirements, required evidence policy, timezone,
  and the source of the commitment.
- The committed window already lives on the job's stops; a planned arrival is
  an ETA and is never the promise.
- Changing a commitment never silently overwrites the original promise.
  Revisions are append-only records carrying the approved revised window, the
  approval attribution and the approval evidence.
- Commitment OUTCOME is DERIVED from evidence (completion event against the
  original window plus revision events). It is never an independently writable
  field that could drift from the evidence.

Commitment outcome states (derived):

| Outcome | Definition |
|---|---|
| fulfilled_on_time | Completion event within the ORIGINAL committed window |
| fulfilled_late | Completion event after the ORIGINAL window |
| saved | A revision exists with recorded approval, and completion is within the REVISED window — while the ORIGINAL outcome is still reported separately as late |
| failed | A terminal non-delivery (failed/skipped with terminal cause) or completion refused by required-evidence rules |
| unknown | No completion event and no terminal state — honest absence of knowledge |

Safeguards, fixed in this definition:

- Original and revised promises are ALWAYS reported independently. A revised
  commitment that was met never hides that the original was missed. There is
  no single green status that compresses both.
- "Saved" is reported as two facts, never one colour.
- Early arrival inside the window counts as fulfilment; arrival before the
  window start is reported separately (early), not mislabelled on-time.
- Cancelled and unconfirmed deliveries are classified as such — never silently
  as failed or fulfilled.

## 8. Recovery (exception response) model

- An **exception episode** is the single authoritative lifecycle for a detected
  threat: `open → investigating → response_in_progress → resolved | closed`.
- Alerts are the presentation/notification projection of an episode for the
  existing Heads-Up surface; they do NOT carry a competing lifecycle.
- Episode creation is IDEMPOTENT: repeated telemetry for the same underlying
  problem must never create duplicate active episodes (deduplication key =
  the underlying condition: job + threat type + originating plan version).
- Response actions are append-only operational-history events, correlated to
  the episode. They reuse the existing event timeline; there is NO separate
  parallel actions table.

Response action types for v1:

| Action | Honest outcome requirement |
|---|---|
| contact_driver | Attempted ≠ reached. Record the attempt and the result separately. |
| notify_customer | Requested ≠ delivered. Delivery is recorded only when a transport confirms it. |
| reassign | Correlates with the existing canonical assignment event; it does NOT duplicate assignment history. Success is evaluated by the new driver's progress, not by the assignment itself. |
| reschedule | Records the revised commitment and the recorded customer approval; the original promise is preserved (Section 7). |
| other | Requires a recorded reason and outcome. |

- A response that fails must be recorded as failed. "Resolved" is written only
  when the outcome evidence supports it.
- Response resolution and commitment outcome are INDEPENDENT dimensions. A
  resolved exception never hides a breached commitment.

## 9. Existing implementation (status vocabulary)

Statuses are NOT interchangeable: `implemented` = code exists; `tested` = suite
covers it; `deployed` = on production; `live-verified` = proven on production
by measurement.

| Capability | Status |
|---|---|
| Multi-tenant Postgres + RLS, transactional outbox, Socket.IO | deployed, live-verified |
| Jobs, CSV import, dispatch board with drag-drop assign + preview | deployed |
| Route optimisation (fleet + per-driver, policies, revisions, 409 staleness) | deployed, live-verified (R9) |
| One-active-plan-per-driver invariant (docs/53 fix) | deployed, live-verified |
| Mid-day re-plan published to drivers | deployed, live-verified (Sarah v124) |
| Driver app (native Android): queue, offline map, photo/signature/recipient evidence, offline command queue | deployed, live-verified on Phone 1 (1.4.5) |
| Position hold containment invariant (property-tested) | deployed, live-verified |
| Completion gate (warn/block, accuracy-aware, default off) | deployed, tested; live columns verified |
| Customer tracking page: stops-away, ETA window, escalating delivery window, POD photo, honest delayStatus | deployed, live-verified |
| Delivery confidence scoring | deployed, tested |
| Idempotency 409 contract (assign/arrive/complete/skip) | deployed, tested |
| Job timeline endpoint (append-only) | deployed, live-verified |
| Driver lifecycle (online/degraded/offline) field | deployed, live-verified |
| Notifications engine with honest statuses | deployed, tested; SMTP transport NOT configured |
| At-risk scoring (stale plans never flagged) | deployed, live-verified |
| Analytics pack (newest-plan dedupe) | deployed, live-verified |
| Geofences: states, overlays, editor | deployed; editor bounds fix live |
| Map pin tap-target hardening (docs/53 Phase 7) | NOT DONE (P0) |
| Second Android device validation | NOT DONE (P0) |
| Backup restoration drill | NOT DONE (P0) |
| Lifecycle change broadcast to dispatcher | PROPOSED (P2) |
| Analytics CSV export | PROPOSED (P2) |
| Remaining idempotency coverage (alert actions, import commit) | PROPOSED (P2) |
| Geofence gate configuration UI | PROPOSED (only before operators configure gates) |

## 10. Commitment Recovery v1 — first milestone

One complete operational capability, end to end:

```text
DETECTED              An assigned delivery is at risk.
                      Reason is explainable: stationary vehicle, insufficient
                      route progress, diminishing window margin - evaluated
                      against live data only.
ACTION REQUIRED       Dispatcher investigates and selects a response.
RESPONSE IN PROGRESS  The response is recorded against the episode.
RESOLVED              The response outcome is recorded truthfully.
                      Commitment outcome is derived independently.
```

Scope: exception episodes + response actions + resolution + the per-job
evidence report. Nothing else ships under this milestone's name.

## 11. Acceptance criteria (positive AND negative)

Positive:

1. An urgent job with a defined window is assigned; its commitment is visible.
2. Fresh telemetry + delay conditions produce ONE explainable episode.
3. Dispatcher reassigns using the existing assignment workflow; the episode
   correlates with the canonical assignment event.
4. The second driver completes with photo + signature + recipient; completion
   is refused until required evidence exists.
5. The recovery history and the evidence report are generated from the
   append-only record.

Negative (these make the demo honest, not theatre):

1. Stale GPS does NOT create a risk episode.
2. Outdated route plans do NOT create risk episodes (R10 stale-plan rule).
3. Repeated telemetry does NOT create duplicate active episodes.
4. A failed response is NOT marked resolved.
5. Offline evidence synchronisation does NOT duplicate records.
6. Resolved exception NEVER hides a breached original commitment.
7. An attempted contact is never shown as a successful contact; a requested
   notification is never shown as delivered.

## 12. Demonstration

- Runs against an isolated SYNTHETIC tenant, clearly labelled, with NO real
  customer or driver data. Ideally a separate environment; at minimum full
  isolation, deterministic scenario seeding, repeatable timelines, and a
  reset mechanism. Demos are never mixed with live operations.
- Target: 120 seconds.
  1. 0-15s  Commitment: urgent delivery assigned with a defined window.
  2. 15-35s Detection: explainable risk episode from fresh telemetry.
  3. 35-65s Intervention: dispatcher reassigns to Driver B.
  4. 65-95s Completion: Driver B completes with photograph, signature,
           recipient information.
  5. 95-120s Evidence: recovery history + complete evidence report.
- Closing message: "PrivateFleet identified an operational threat, recorded the
  intervention, and preserved the evidence of completion."
- The negative tests in Section 11 are part of the demonstration rehearsal.

## 13. Priorities

| Priority | Work | Reason |
|---|---|---|
| P0 | Map pin tap-target identity (docs/53 Phase 7) | Existing usability defect |
| P0 | Second Android phone validation (offline/sync) | Multi-device confidence |
| P0 | Backup restoration drill, documented | Operational trust |
| P1 | Commitment Recovery v1 (Sections 8, 10, 11) | Core differentiator |
| P1 | Per-job evidence report | Deliverable customer artefact |
| P2 | Driver lifecycle broadcast to dispatcher | Complete visibility |
| P2 | Remaining idempotency coverage | Durable operations |
| P2 | Analytics CSV export | Reporting completeness |
| P3 | Contract economics (billing-readiness only) | After workflow validation |
| Deferred | S3 shift statistics (docs/52) | Remains deferred |

## 14. Commercial hypothesis (unvalidated)

- Buyer: owner / MD / operations director of a London specialist B2B delivery
  operator.
- Problem: commitments fail invisibly; responses are undocumented; evidence is
  scattered; the owner cannot reconstruct what happened without asking people.
- Proposition: one closed loop — keep, respond to, and prove every commitment.
- Key unvalidated assumption: an operator will pay for this loop. The
  commercial test: using the synthetic scenario, demonstrate that PrivateFleet
  produces owner-level information that is difficult to reconstruct from
  ordinary tracking software, spreadsheets and delivery records.
- PrivateFleet is NOT yet a proven commercial opportunity. It is a substantially
  developed product with a coherent, testable differentiation hypothesis.

## 15. Non-goals

No generic fleet-feature expansion. No dashboard sprawl. Every proposed feature
must answer: does this improve the ability to keep, respond to, or provide
honest evidence of a customer commitment? If not, it does not belong in v1.

## Decisions We Deliberately Refuse to Make in v1

1. **No contract engine.** Per-job commitments only; contract templates are a
   later, evidence-based decision.
2. **No separate RecoveryAction table.** Response actions are append-only
   events in the existing operational history, correlated to episodes.
3. **No general-purpose billing or accounting system.** P3 is billing-readiness
   only: billable jobs, charges, reattempts, supporting evidence, export.
4. **No AI prediction engine.** Risk is explainable rules over live data.
   Explainability is the honesty mechanism; no black boxes.
5. **No webhooks (R12) and no scoped API keys (R13).** Deferred until an
   integration surface is demanded by real usage.
6. **No uniform API rate-limit contract (R14) beyond existing abuse
   protection.** Deferred with R12/R13.
7. **No dashboard expansion.** Existing screens and terminology are preserved;
   no imported screen taxonomies.
8. **No customer-notification advertising as delivered (SMTP).** Not until a
   transport confirms delivery.
9. **No certification claims** (ISO 27001, SOC 2, etc.) unless actually
   achieved.
10. **No S3 shift statistics** — remains deferred as decided earlier; not part
    of the v1 loop.

## Architectural principles (fixed)

- Reuse existing reliable structures; never duplicate a representation that is
  already maintained correctly elsewhere.
- One lifecycle per domain entity (alerts project episodes; they do not compete
  with them).
- Append-only operational history; corrections are new events.
- Derived outcomes wherever evidence permits; never writable fields that can
  drift from the record.
- Never claim an action succeeded without confirmation.
- Never overwrite the original customer promise.
- Never present stale or uncertain information as fact.

## Status of this document

DRAFT. To be audited against docs/52 (differentiators), docs/53 (route
instability forensics), docs/54 (competitive backlog) and docs/55 (modularity
discipline), every claimed capability reconciled, and only then frozen as the
product authority for v1.
