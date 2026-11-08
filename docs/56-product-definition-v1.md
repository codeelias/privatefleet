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
| Commitment Risk Engine | Explainable, rules-based risk derived from live data only. `Operational Risk = f(Commitment, ETA, Progress, Telemetry, Delay)`. Stale plans and stale fixes are never scored (R10 protections reused, not duplicated). Named "Commitment Risk" deliberately: we do not use "SLA" until contractual SLA rules actually exist — naming something it is not is a false claim. |
| Exception Response | A detected threat becomes an actionable episode; responses are recorded with outcomes. The system helps operators respond, not merely report. |
| Verifiable Handover & Evidence | A chain of custody, not a file: capture time vs server receipt time, device location and accuracy, content-integrity verification, recipient-declared information, driver identity, recorded corrections (corrections-as-events: PROPOSED, not yet implemented). |
| Accountability & Performance | Per-customer on-time performance, failures, reattempts, exception causes, evidence completeness — and later, billing-readiness (billable jobs, charges, unbilled work). Built AFTER the operational loop is proven (P3). |

## 6. Trust model

Five guarantees. Trust is demonstrated behaviour under failure, never claimed
architecture:

| Guarantee | Meaning | Validation required |
|---|---|---|
| Location integrity | Freshness and accuracy are displayed; stale GPS is never presented as live | Containment-invariant position hold (property-tested), lifecycle states, stale-plan guards |
| Evidence integrity | Original events preserved; corrections recorded as new events (corrections-as-events: PROPOSED, not yet implemented); files served only after hash verification | Content-hash check before serving (live-verified); tamper test in suite |
| Offline reliability | Drivers can capture and QUEUE completion evidence while offline; the server accepts the completion after successful synchronisation and validation; synchronisation must not duplicate operational records. A queued local action is NOT an accepted server-side completion | Command queue + idempotent sync (implemented, tested, live on Phone 1); second-device validation outstanding — do not claim universal reliability from one device |
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
- When several reschedules occur, the RISK ENGINE uses the currently effective
  approved window (the latest approved revision that is in force); historical
  reporting retains every previous promise.
- Commitment OUTCOME is DERIVED from evidence (completion event against the
  original window plus revision events). It is never an independently writable
  field that could drift from the evidence.

Completion-time semantics (fixed rule — offline reality makes this critical):

- `device_captured_at`: device-reported occurrence time. Evidence rows already
  carry it. It is NOT automatically trustworthy.
- `server_received_at`: authoritative server receipt time. It establishes when
  the backend received the record — NOT when the physical handover happened.
- `completion_accepted_at`: when the server accepted the completion command
  together with its required evidence. The authoritative operational fact of
  completion.

Classification rule: commitment timing is judged by the device-reported
capture time when one exists and is PLAUSIBLE (within the configured clock-skew
tolerance); otherwise the timing is `timing_unverified`. The server receipt
time is NEVER silently used as delivery time. Neither an offline device clock
nor the server clock is assumed authoritative for the physical handover.

Commitment outcome is three independent dimensions, never compressed:

| Dimension | Values |
|---|---|
| Delivery outcome (derived) | fulfilled_within_window · fulfilled_late · early · not_delivered · cancelled · unconfirmed |
| Evidence completeness (derived from policy vs captured evidence) | complete · incomplete |
| Timing verification (derived) | verified · timing_unverified |

Definitions:

- fulfilled_within_window: verified delivery time inside the ORIGINAL window.
- fulfilled_late: verified delivery time after the ORIGINAL window.
- early: verified delivery time before the window start — reported separately,
  never mislabelled on-time.
- not_delivered: confirmed TERMINAL non-delivery with a terminal cause. A
  skipped stop is NOT terminal non-delivery: it may be reattempted.
- cancelled: explicitly cancelled — never silently failed or fulfilled.
- unconfirmed: no sufficient evidence of completion and no terminal state.
- Evidence incompleteness (missing required photo etc.) does NOT establish
  that the delivery failed; it establishes that evidence requirements were
  not satisfied. It is reported on the evidence dimension, not the delivery
  dimension.

"Saved" is a DERIVED RELATIONSHIP, not an independent outcome: original
outcome and revised outcome are reported side by side. Example: original
10:00–11:00, approved revision 10:30–11:30, verified completion 11:20 →
original `fulfilled_late`, revised `fulfilled_within_window`. Both facts are
preserved; no single green status may compress them.

## 8. Recovery (exception response) model

- An **exception episode** is the single authoritative lifecycle for a detected
  threat: `open → investigating → response_in_progress → resolved | closed`.
- Alerts are the presentation/notification projection of an episode for the
  existing Heads-Up surface; they do NOT carry a competing lifecycle.
  **Ownership rule (fixed): the episode owns the operational lifecycle. Alert
  acknowledgement, visibility and delivery are presentation semantics only —
  an alert state can NEVER independently resolve, close or invalidate an
  episode.** Reusing the existing alert infrastructure must not create a
  second operational lifecycle.
- Episode identity and deduplication (fixed): an ACTIVE episode is unique per
  **(job, threat class)**. Plan version is PROVENANCE and episode context —
  it is never part of threat identity, so a mid-day re-plan (new plan version
  under the same threat) must never create a second episode. An approved
  reschedule changes the effective commitment the threat is evaluated against;
  it updates the episode context, it does not spawn a duplicate. A NEW episode
  is permitted only when a previously resolved threat genuinely recurs (a
  fresh threat condition arising from new data).
- Episode closure semantics: `resolved` = the threat was addressed and the
  resolution is supported by evidence. `closed` = the episode is no longer
  actionable for an explicitly recorded reason — `duplicate`, `invalidated`
  (underlying commitment or conditions changed), or `superseded`. Closing an
  episode NEVER implies successful recovery.
- Response actions are append-only operational-history events, correlated to
  the episode. They reuse the existing event timeline; there is NO separate
  parallel actions table. Actions are reversible where supported; reversals
  are appended as new events, never edits to history.

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

Statuses are NOT interchangeable. Implementation evidence statuses:
`implemented` = code exists; `tested` = suite covers it; `deployed` = on
production; `live-verified` = proven on production by measurement. Plan
statuses: `proposed` = agreed scope, not built; `not_done` = identified, not
started; `partial` = part shipped, remainder agreed.

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
| Corrections-as-events for evidence | PROPOSED — named as a guarantee only after implemented and tested |
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
- Three INDEPENDENT evidence categories, never conflated:
  | Category | What it establishes |
  |---|---|
  | Technical evidence | The system behaves correctly |
  | Product-value evidence | The workflow provides a meaningful advantage over existing methods |
  | Commercial evidence | A genuine buyer has demonstrated willingness to pay |
- The synthetic scenario is the **product differentiation demonstration**: it
  can establish that PrivateFleet reconstructs an operational incident
  coherently. It CANNOT establish that an operator will pay — those are
  separate hypotheses.
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
11. **R15 deferred**: neither a public operational status page nor a
    security/trust information page ships in v1 — kept distinct from each
    other when they eventually do.

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

The implementation discipline in docs/55 remains GOVERNING and is referenced
here, not duplicated: one module per change; documented module-boundary
crossings; required verification gate; verify copied files exist remotely
before restart; wholesale web synchronisation.

## Status of this document

DRAFT. To be audited against docs/52 (differentiators), docs/53 (route
instability forensics), docs/54 (competitive backlog) and docs/55 (modularity
discipline), every claimed capability reconciled, and only then frozen as the
product authority for v1.
