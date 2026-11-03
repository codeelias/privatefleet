# 47 - £10,000 valuation readiness: engineering due diligence audit

Date: 2026-11-03 (inspection date). Supersedes doc/46 where evidence changed.
Method: repository + live system inspection; read-only. No code, schema or
production changes were made.
Evidence anchors: HEAD `d1738c0`; deployed native **1.0.14**; host migrations
through `0017`; `healthz ok`; live DB: 148 jobs (Mo 48 / Tom 72 / Sarah 26),
routes v123 with 3701-8681 geometry points.

---

## PART A - The five £10,000 objectives (assessed separately)

| Objective | Feasible today | Realistic buyer | Notes |
|---|---|---|---|
| 1. One-off licence | No (not yet) | One courier operator, 10-40 vehicles | Needs pilot evidence + onboarding pack |
| 2. Annual subscription | No | Same, after pilot | Needs billing, SLA, support org |
| 3. Perpetual licence | No | As 1 | Same blockers as 1 |
| 4. Sale/transfer of IP | No | Software company/integrator | Needs clean ownership file + non-repudiable docs + IP audit |
| 5. Business valuation | No evidence | n/a | Zero revenue/traction; value = engineering asset |

**Most realistic first commercial model:** a **paid pilot** (~one month fee),
then a **one-off licence + annual support** contract for a single operator.
Subscription-only is not credible until recurring delivery is proven.

## PART B - Product capability audit

Status key: VO=verified operational, IT=implemented under-tested, P=partial,
D=demo-only, M=missing, U=unknown.

| Capability | Status | Evidence |
|---|---|---|
| Fleet/vehicle management | VO | live vehicles/drivers/routes; registration, types, statuses |
| Driver management | VO | PIN login both phones, shifts, statuses |
| Live GPS tracking | VO | both vehicles posting; StationaryGate verified 0 m drift (Phone 1 capture 14:31-14:38 UTC) |
| Route planning/optimisation | VO | OSRM+VROOM live, v123, policy gates, 30-job regression (docs) |
| Assignment/dispatch | P | manual publish works; **atomic assign+re-optimise missing** |
| Driver-dispatch comms | P | request-more-jobs + dispatcher decision; **no native push** |
| Delivery/job management | VO | lifecycle arrive/complete/skip/fail live |
| Exception management | P | alerts + heads-up exist; **no production delivery channel** |
| Proof of delivery | VO (storage) / P (delivery) | signatures+photos stored; **no customer PDF/audit export** |
| Reporting/analytics | P | CSV reports; **no scorecard/cost-to-serve** |
| Customer notifications | M | none (no SMS/email) |
| Administrative controls | P | policies, geofences, roles; **no guided onboarding** |
| Multi-user/permissions | VO | owner/dispatcher/driver roles, RLS |
| Mobile reliability | VO (core) | foreground service, offline queues; **battery soak unverified** |
| Offline operation/recovery | IT | offline command/evidence queues tested earlier; no current-matrix rerun |
| Dispatcher usability | VO | keyboard/focus/dock/HUD; accessibility unverified |

## PART C - Customer proposition and ROI model

Measurable today: none of the nine value drivers has an operator baseline.
Pilot-only measurements: planning minutes, on-time %, exceptions-before-call,
POD disputes, mileage.

Illustrative ROI (assumptions labelled; not measured):

```text
12-vehicle same-day courier, dispatcher planning ~2 h/day:
- save 1 h/day @ £18/h fully loaded = ~£4,500/yr (assumption)
- catch 2 missed-window exceptions/wk before refunds @ £25 each = £2,600/yr (assumption)
- POD dispute resolution time halved: 2 h/wk @ £18 = ~£1,900/yr (assumption)
Total illustrative benefit ≈ £9,000/yr → £10k licence payback ~14 months (illustrative)
```

A buyer recovers £10,000 only if the pilot measures at least this order of
benefit. These are scenarios to validate, never to quote.

## PART D - Operational journey audit (10 steps)

1. Create job: VO (UI + CSV import).
2. Assign vehicle/driver: VO (manual).
3. Optimise: VO.
4. Assign: VO (manual publish).
5. Communicate to driver: P - queue refresh only, no push.
6. Track: VO.
7. Detect exceptions: P - detected, not delivered to customer.
8. Reassign/re-optimise: M for atomic flow (single-driver reroute exists).
9. Confirm delivery: VO.
10. Reports: P.

A new customer cannot complete the journey without developer assistance at:
tenant setup, driver app install (APK sideload), depot/policy configuration,
and report interpretation. Highest-value missing capability: **step 8**.

## PART E - Reliability and engineering maturity

| Area | State | Evidence |
|---|---|---|
| Backups | operational | scheduled `.dump.age` to Google Drive |
| Restore drill | stale | last timed drill pre-dates migrations 0013-0017 |
| API error handling | VO | structured errors, retry guidance |
| Android foreground svc | VO | both phones posting; wake lock |
| Network retries | VO | telemetry retries; command/evidence queues |
| Data consistency/ordering | VO | sequence, out-of-order rejection (tests) |
| Idempotency | VO | command keys tested |
| Outbox | VO | tested; backfill scripts exist |
| Socket live updates | VO | E2E verified |
| Load/soak | stale | predates current policy/native work |
| Monitoring | P | 5-min health watchdog; **no alert destination** |
| Latency | U | no measured SLO |
| Release mgmt | P | manual scp + scheduled task; versioned manifests |
| Rollback | M | not scripted/tested |
| CI/CD | M | no pipeline; **tests depend on a manually managed local Postgres, which was down at audit time** (full API suite red: 2/110 failed, rerun 7 suites 500s; last green 102/102 at 02:15 UTC) |
| Signed Android | VO | release keystore verified |
| Dependency vulns | M | no audit tooling |
| Staging | M | none |

## PART F - Positioning and PF-TIDE assessment

Exists and operational: provider flow, StationaryGate, pf-diag/pf-raw,
quality fields, MapLibre rendering, projection-distance confidence, OSRM
route geometry, RTKLIB/JNI compiled (dormant), NTRIP client (dormant),
PF-TIDE Core shadow (adaptive R, NIS, prediction, dual horizon, delayed
replay) with 8 unit tests, live shadow endpoint.

Not built: HMM road matching, route-relative constraint, IMM, presentation
swap, field-validated accuracy.

PF-TIDE minimum to produce measurable improvement: (1) run shadow vs baseline
on the two-phone field data, (2) only if it wins on Category A, swap the
presentation layer, (3) stop there. HMM/IMM/ML are not commercially material
now. Legitimate claims with two phones: consistency/stability/honesty. Absolute
accuracy claims require the OS Net PPK validation (in progress; base RINEX
received, rover capture working).

## PART G - Security, compliance and ownership

Technical (audited): argon2 auth, RLS multi-tenancy, keystore encryption,
FLAG_SECURE, TLS with internal CA, per-tenant scoping tests.
Legal/specialist (flagged, not assessed): DPIA required for employee location;
medical transport raises special-category processing obligations; privacy
notice + DPA absent; retention/deletion policy absent.
Dependencies: OSRM/VROOM (BSD), RTKLIB (BSD-2), PostgreSQL/PostGIS
(PostgreSQL licence), OpenFreeMap styles + OSM data (ODbL attribution - we
comply; no API keys), MapLibre/Leaflet (BSD), React/Tailwind (MIT). No
dependency found that blocks independent operation or transfer. IP ownership:
all source in-repo; release keystore owner-held; contracts from source.

## PART H - Packaging and delivery

Missing first-day package: onboarding runbook, tenant setup script, driver
install guide, dispatcher training doc, driver one-pager, SLA/support terms,
release notes, POD export, offboarding/export procedure, pricing sheet.
Present: the software itself and internal runbooks (docs/24, 16).

## PART I - The three £10,000 scenarios

- **A. One-off licence:** not supportable today; conditions: paid pilot +
  measured ROI + onboarding pack + support terms.
- **B. Annual contract:** not supportable; additionally needs billing, SLA,
  alerting, support organisation.
- **C. IP acquisition:** not supportable; needs IP schedule, licence audit,
  clean-room docs, transfer plan.

£10,000 is **not currently defensible** under any scenario.

## PART J - Deliverables

### 1. Executive verdict
**Credible pilot** (not demonstration; not commercially ready). Engineering
ahead of commercial evidence; assurance layer incomplete.

### 2. Gap register (top 12, priority-ordered)

| # | Gap | Impact | Pri | Remedy | Effort | Owner |
|---|---|---|---|---|---|---|
| 1 | No operator baseline/signed scope | no evidence | P0 | commercial | 1-2 wk | Founder |
| 2 | Tests not CI-gated; local DB down broke suite | trust | P0 | CI + managed test DB | 2-3 d | Dev |
| 3 | Restore drill stale | recovery unproven | P0 | run+time | 1 d | Dev |
| 4 | No alert destination | silent failure | P0 | wire channel | 1 d | Dev |
| 5 | Atomic assign+re-optimise | core promise | P0 | dispatch loop | 2-3 wk | Dev |
| 6 | DPIA/retention/notice | legal blocker | P0* | specialist | 1-2 wk | Legal |
| 7 | POD customer export | weak POD claim | P0 | PDF/audit export | 3-5 d | Dev |
| 8 | No notifications | exception value lost | P1 | email/SMS gateway | 1 wk | Dev |
| 9 | No onboarding pack | dev dependency | P1 | runbook+scripts | 1 wk | Dev |
| 10 | Field validation | accuracy unproven | P1 | PPK + A/B | 1-2 wk | Dev+Founder |
| 11 | Support/SLA terms | retention | P1 | 1-pager | 2 d | Founder |
| 12 | Accessibility/dep audit/pinning | premium claim | P2 | packs | 1-2 wk | Dev |

\* P0 for medical verticals; P1 otherwise.

### 3. Commercial readiness matrix
- Paid pilot: close gaps 1-4, 7 (and 6 for medical); ~30 days.
- £3-5k licence: pilot measured + gaps 5, 9, 11.
- £10k licence: all of the above + measured ROI + notifications + support
  contract.

### 4. Technical scorecard (evidence, confidence)

| Area | Score | Confidence |
|---|---|---|
| Dispatch | 4/5 | high (tests + live) |
| GPS/mobile | 3.5/5 | high (live + capture) |
| Reliability/assurance | 2.5/5 | high (restore/alerting/CI gaps) |
| Security | 3/5 | medium (RLS strong; compliance absent) |
| Reporting | 2/5 | high |
| Usability | 3.5/5 | medium (a11y unverified) |
| Deployment/maintainability | 2.5/5 | high |
| Positioning validation | 2/5 | high (unvalidated accuracy) |
| Scalability | 2/5 | low confidence (unmeasured) |

### 5. Commercial validation plan
Operator evidence: baseline sheet, signed pilot scope, buyer objections,
willingness-to-pay interview. Metrics: planning min, on-time %, exceptions
pre-call, POD disputes, mileage/fuel, dispatcher interventions. All require
a real operator; none obtainable synthetically.

### 6. 30/60/90 roadmap by owner
- 30 d: Dev - CI + managed test DB, restore drill, alert channel, POD export.
  Founder - design partner + baseline sheet. Ops - run PPK field session.
- 60 d: Dev - atomic assign+re-optimise, onboarding pack, email notifications.
  Legal - DPIA/retention. Founder - pilot contract signed.
- 90 d: pilot measurement, scorecard, support terms, price decision.
- Stop: IMM, HMM, own RTK base, ML profiles, XLSX, multi-depot, branding app.

### 7. Final valuation-readiness decision
- **Worth £10,000 today?** No.
- **Realistic £10,000 transaction?** None yet; nearest is a paid pilot now, a
  one-off licence after measured pilot.
- **Biggest refusal reason:** no customer evidence and no support
  organisation; buyers pay for proof, not features.
- **Five highest-value changes:** CI/reliability gate; atomic dispatch loop;
  POD export; onboarding pack; measured pilot (commercial).
- **Must be proven, not developed:** dispatcher time saved, on-time
  improvement, exceptions caught pre-call, POD disputes closed, GPS trust.
- **Stop developing:** further positioning sophistication, geofence/UI
  breadth, any feature without a named buyer problem.
- **Minimum evidence before approaching a customer:** green CI, restore drill
  result, alert proof, POD export demo, and one design-partner meeting.
- **What must be true to defend £10k:** signed pilot with measured
  before/after matching the ROI model, support terms, compliance artefacts,
  and a named reference customer.
