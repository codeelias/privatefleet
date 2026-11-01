# 27 - Stage-plan review and build order

Date: 2026-11-01  
Audit baseline: `c400476` (native offline evidence queue)  
Live environment: LAN pilot at 192.168.1.128, synthetic data only.

This is the consolidated review of the agreed phase plan, the native-client
pivot, and the commercial gates. It replaces conflicting statements in earlier
status notes. The rule is simple: **deployed and evidenced is GREEN; built but
not proven is AMBER; not built is RED.**

---

## 1. Verdict

PrivateFleet is a credible **pilot platform** with unusually strong dispatch
mechanics for its stage: tenant isolation, policy revisions, baseline gates,
VROOM 1.15, route lifecycle, offline driver evidence and background GPS are
real and tested.

It is **not yet a product that can be sold at GBP 10k without a named pilot**
because:

1. Phase 0 was never closed - no operator, no baseline metrics, no signed scope.
2. The dispatch control loop is incomplete: work can be planned and approved,
   but a driver request or recommendation cannot be turned into an atomic
   assignment-and-reoptimisation decision.
3. Customer-facing value (branded ETA, proactive exception communication,
   proof links) is present in modules but not yet proven as a daily workflow.
4. Reliability evidence is stale: E2E, load/soak and restore drill predate the
   current policy, native app and route lifecycle.
5. Compliance, support SLA, release signing and monitoring are not yet at the
   level implied by a "prestige" sale.

Engineering is ahead of commercial validation. The next work must convert
existing capability into measurable customer outcomes, not add breadth.

---

## 2. Agreed phases vs deployed reality

| Phase | Original hard gate | Current state | Verdict |
|---|---|---|---|
| 0. Validate | Named design partner, real workflow, baseline metrics, scope | No partner, no baseline, no signed scope | RED |
| 1. Demo | 120-second hands-free demo, E2E green, new-dev setup | Real API/screens exist; E2E not rerun; rehearsal not evidenced | AMBER |
| 2. Backend | Auth/RLS/lifecycle/idempotency/outbox tests | 90 API tests, RLS, outbox, lifecycle, orphan invariant | GREEN |
| 3. Driver workflow | Real driver completes real job; dispatcher sees it without refresh | Native app has real login, queue, arrive/complete, signature, photo, failure, offline queue; realtime dispatcher view not re-verified | AMBER |
| 4. Live tracking | Field map, staleness, edge cases | Native screen-off GPS verified; Socket.IO snapshot not re-verified; off-route warning only on fresh GPS | AMBER |
| 5. Optimisation | Correct infeasible handling, conflict-free publication, stored run evidence | OSRM/VROOM, policy revisions, gate, stale rejection, cost advice | GREEN |
| 6. Pilot hardening | Acceptance, recovery, monthly restore, scripted provisioning | DNS/Tailscale/TLS/backups exist; restore stale; monitoring/log-only; compliance absent | AMBER |
| Native pivot | Production native driver app | Native client replaces Expo for pilot use; release signing, battery soak, distribution absent | AMBER |

### Phase 0 is the only true blocking gate

No amount of code closes it. It needs a named courier operator, their current
stops/day, on-time percentage, exception rate, planning time, fuel/km and a
signed pilot scope. Without those numbers the GBP 10k claim is a hypothesis.

---

## 3. Scope changes that must be recorded

These changes are real and should not be presented as "original plan delivered".

1. **Driver client:** the approved Expo-first decision (A6) was superseded by a
   native Android client. Expo remains the older field build; native is the
   pilot path. This is a deliberate architecture change, not a hidden rewrite.
2. **Driver request workflow:** request and dispatcher decision are deployed.
   Assignment and re-optimisation are **not** connected. A request currently
   records intent; it does not add work.
3. **Background GPS:** implemented in the native foreground service and verified
   screen-off. Battery life over a full shift is not measured.
4. **Native evidence:** photo/signature upload and encrypted offline evidence
   queue exist. Failure-photo capture and native offline *conflict UI* do not.
5. **Security:** native session, command queue and evidence are encrypted with
   Android Keystore; FLAG_SECURE is on. Certificate pinning, root/tamper
   detection, release signing and key rotation are not done.
6. **Data:** the unique `(tenant_id, reference)` index is enforced. Cross-tenant
   duplicate-looking references are not integrity failures. Load/E2E tenants
   and historical routes still need an audited cleanup.

---

## 4. Customer value chain audit

A courier operator buys outcomes in this order. The gaps are ranked by how
directly they affect the buyer.

### 4.1 Plan work

- CSV import, validation, pickup/dropoff pairing: GREEN.
- Policy presets and per-vehicle limits: GREEN.
- Baseline gate and stored proposal evidence: GREEN.
- **Gap:** no single "today's plan" view with promised windows vs achievable
  windows and a plain-language reason when work cannot be assigned. AMBER.

### 4.2 Assign and adapt

- Fleet optimisation and manual route publication: GREEN.
- Cost-aware recommendations: GREEN, advisory only.
- Driver request and dispatcher decision: GREEN.
- **Gap:** one-click assign + re-optimise is missing. This is the core
  differentiator: the dispatcher sees "add this job to Tom for +6 min and
  +GBP 1.40", then commits atomically.
- **Gap:** dispatch-origin resolver (depot vs last GPS vs shift start) missing.
  Without it, distance and ETA can start from the wrong place.
- **Gap:** unassigned reasons are solver codes, not operator language.

### 4.3 Execute

- Native login, shift, queue, nearest ordering, paging: GREEN.
- Arrive/complete/sign/photo/fail, offline commands and offline evidence: GREEN.
- **Gap:** no native route map or turn-by-turn handoff; no push notification for
  a new assignment. The driver must refresh the queue.
- **Gap:** no native ETA or "next stop by planned sequence" mode. Nearest-first
  is useful, but real operators may require the published sequence or time
  windows; the driver must not silently defeat a time-window plan.

### 4.4 Track and communicate

- Foreground and background GPS, staleness labelling: GREEN.
- Customer tracking module exists: AMBER until proven end-to-end with a real
  customer link, ETA and branding.
- **Gap:** proactive customer notification on delay/exception is not proven;
  the customer should hear from the operator before they phone in.
- **Gap:** dispatcher live map realtime update has not been re-verified after
  the latest route/policy changes.

### 4.5 Prove and get paid

- Signature/photo evidence, recipient name, failure reasons, duplicate-safe
  upload: GREEN.
- **Gap:** branded proof-of-delivery link/PDF and evidence retention policy are
  not packaged as a customer deliverable.
- **Gap:** no audit export for a dispute ("who signed, when, where, which stop").

### 4.6 Improve

- Reports module exists; cost recommendations exist.
- **Gap:** no agreed weekly operator scorecard: stops/day, on-time %, km/job,
  fuel cost, exceptions caught before the customer calls, driver adherence.
- **Gap:** no 30-day reliability evidence to support an SLA.

---

## 5. Efficiency and optimisation audit

What is genuinely strong:

- One VROOM solve over eligible vehicles, not per-vehicle greed.
- Visit-order preservation and geometry consistency are regression-tested.
- Policy revision is captured with the proposal; stale approval is rejected.
- Baseline gate applies only to identical job scope; hard limits always apply.
- Cost recommendations include fuel, vehicle running cost, wage and detour.

What prevents "highly optimised for the real job":

1. **No re-optimisation loop after assignment.** The plan is a snapshot; real
   dispatch changes every hour.
2. **No origin resolver.** Travel time is only as good as the assumed start.
3. **No time-window feasibility explanation.** The dispatcher sees failure, not
   "this job misses its window by 12 minutes because of the 14:30 pickup".
4. **No live traffic.** OSRM is free-flow; this must be labelled honestly and
   not sold as traffic-aware.
5. **No driver adherence loop.** Planned vs actual arrival variance is not fed
   back into recommendations.
6. **No cost-to-serve per job.** The operator cannot see which jobs erode margin.

These are the features that separate a solver demo from an operations product.

---

## 6. "Prestige quality" scorecard

| Dimension | State | What "good" looks like |
|---|---|---|
| Tenant isolation | Strong | RLS + app scoping + cross-tenant tests |
| Auditability | Partial | Every assignment/closure/approval exportable with actor and reason |
| Availability | Pilot | Health checks, restart automation, alert channel, SLO |
| Recovery | Stale | Restore drill on current schema with timed evidence |
| Security | Improving | Release signing, key management, dependency audit, tamper detection |
| Privacy | Not done | DPIA, retention, subject-access process |
| Accessibility | Unknown | Contrast, touch targets, screen-reader pass |
| Driver reliability | Good | 8-hour battery soak, crash-free session, offline matrix |
| Support | Not done | Support SLA, escalation, known-error runbook |
| Commercial | Not done | Named pilot, success metrics, licence scope, acceptance criteria |

You cannot charge a prestige price for a system whose recovery, support and
compliance evidence is thinner than its feature list.

---

## 7. What must be true before a GBP 10k sale

1. A named operator has agreed the workflow and baseline metrics in writing.
2. The 120-second demo runs hands-free and every claim is traceable to stored
   data.
3. The customer can see: planned vs actual, on-time %, exceptions caught before
   the call, and cost per stop.
4. A driver can complete a full shift natively, offline included, with evidence.
5. The dispatcher can reassign and re-optimise atomically, with a plain-language
   impact preview.
6. Restore, E2E, soak and security evidence are current, not from an older build.
7. Licence, support, retention and DPIA scope are explicit.

---

## 8. Build order

### Stage A - Prove and package (next, 2-3 weeks)

Commercial (owner-led):

- Name the design partner and vertical.
- Record baseline: stops/day, on-time %, exceptions/day, planning minutes,
  fuel/km, evidence failures.
- Agree pilot success metrics and scope; sign pilot terms.
- Run and time the 120-second rehearsal; fix every point of confusion.

Engineering:

- Audited demo/load tenant cleanup and historical-route closure.
- Rerun E2E, load/soak and restore drill on the current schema.
- Release-sign the native app and publish an internal update channel.
- Add monitoring/alert channel and a one-page support runbook.
- Fix stale docs (this document is the baseline).

**Gate:** a real operator has watched the demo, agreed metrics and signed a
scoped pilot; all current-build evidence is green.

### Stage B - Close the dispatch loop (3-4 weeks)

1. Dispatch-origin resolver: depot/shift start, fresh GPS, dispatcher override,
   explicit LIVE/STALE/DEPOT state.
2. One-click assign + re-optimise: preview fuel/time/wage/route impact, commit
   atomically, preserve arrived/completed stops, reject stale policy.
3. Driver request -> candidate job -> dispatcher approval -> assignment.
4. Plain-language unassigned reasons and time-window explanations.
5. Native push/refresh for new assignments.

**Gate:** a dispatcher can take a new job from "unassigned" to a published,
policy-compliant route in one reviewed action, with no orphan assignments.

### Stage C - Customer-facing value (3-4 weeks)

1. Branded customer tracking link with ETA, driver name, stop status and proof.
2. Proactive delay/exception notification with honest reason and revised ETA.
3. Proof-of-delivery PDF/link and dispute-ready audit export.
4. Weekly operator scorecard with the agreed baseline metrics.
5. Cost-to-serve per job and per customer.

**Gate:** a real customer uses the link, and the operator can show a measured
improvement against the Stage A baseline.

### Stage D - Scale and assure (ongoing)

- 30-day reliability evidence and SLO.
- DPIA/retention, drivers' hours review, accessibility pass.
- Multi-instance rate limiting, dependency upgrades, key rotation.
- Security review and penetration test before any medical-transport data.

---

## 9. Metrics that decide whether this is working

Track weekly, per tenant:

```text
stops/day
on-time % (promised window vs actual)
planning minutes per day
km per stop and fuel cost per stop
jobs per driver per shift
exceptions caught before the customer calls
evidence success rate, including offline
tracking uptime and stale-pin rate
dispatcher interventions per 100 stops
driver crash-free sessions and battery drain per shift
support tickets per 100 stops
```

If these do not improve against the Stage A baseline, the product is not
earning a premium price regardless of feature count.

---

## 10. Decisions required from the owner

1. Which vertical and named operator is the pilot? Courier first, as planned?
2. Is the pilot's priority on-time performance, fuel/km, driver adoption or
   customer communication? The answer changes Stage B/C order.
3. What is the support window and SLA during the pilot?
4. Is the GBP 10k a licence + implementation fee, a pilot fee, or both?
5. Will the pilot handle personal data that triggers a DPIA now, or only after
   the medical vertical is pursued?

---

## 11. Immediate next action

Do not start another UI feature. Start Stage A:

1. Clean the demo/load tenants and historical routes with an audited script.
2. Rerun E2E, soak and restore on the current build.
3. Release-sign the native app.
4. Prepare the one-page baseline/metrics sheet for the design partner.
5. Rehearse the 120-second demo and record the run.

Stage B starts only when a named operator has agreed the metrics; otherwise the
team will optimise a workflow no customer has committed to.
