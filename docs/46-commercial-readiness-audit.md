# 46 - Independent commercial readiness audit (£10,000 target)

Date: 2026-11-03 (research and inspection date)
Method: repository + deployed-system inspection, live test execution, market
research. No production changes were made.
Baseline evidence: HEAD `a69ea06`; deployed native **1.0.14** (versionCode 15);
host migrations through `0017` applied; API `healthz ok`.

---

## 1. Commercial target - three valuations, not one

- **A. £10,000 upfront implementation contract** (primary target): licence +
  deployment + migration + training + pilot + support terms. Requires a
  customer-specific handover that does not exist today (see §6).
- **B. £10,000 annual SaaS**: recurring subscription; needs per-vehicle
  pricing, hosting SLAs, renewal evidence. No subscription billing, no SLA,
  no multi-tenant operations team. Not realistic before A succeeds.
- **C. £10,000 business valuation**: transferable value would need a signed
  customer, recurring revenue or proven demand. Today: **no evidence**; value
  is engineering asset only.

Customer profile most likely to buy A: a **same-day courier or medical
transport operator with 10-40 vehicles** currently running spreadsheets, who
already failed with a consumer route planner.

## 2. Verified product state (capability classes)

Class scale: 1 source / 2 tests / 3 deployed / 4 verified live / 5 field
validated / 6 customer-used / 7 commercial value.

| Capability | Class | Evidence |
|---|---|---|
| Auth + roles (owner/dispatcher/driver) | 4 | JWT, refresh rotation; live logins on both phones |
| Tenant isolation + RLS | 4 | RLS tests exist; host applied |
| Job/shipment management, statuses | 4 | live 148 jobs (Mo 48, Tom 72, Sarah 26) |
| CSV import + validation | 4 | import module + tests; not re-run against current schema since test failure below |
| Route optimisation (OSRM+VROOM) | 4 | live routes v123 (geometry 3701-8681 pts) |
| Capacity/policy constraints | 4 | policy revisions, stale rejection tested |
| Assignment/approval workflow | 4 | manual publish; **no atomic assign+re-optimise** |
| Driver app + telemetry | 4 | both phones post; pf-diag/pf-raw verified |
| Stale handling + provenance | 4 | StationaryGate, movementState, quality fields |
| Live dispatcher map | 4 | routes/confidence/HUD verified after fix |
| Route execution/stop progression | 4 | driver flow used in pilot |
| Exceptions/alerts | 3 | local webhook sink; **production URL pending** |
| Proof of delivery | 4 | signatures/photos stored; **no customer export/PDF** |
| Customer tracking portal | 3 | works; not used by a real customer |
| Reports/exports | 3 | CSV reports; no operator scorecard |
| Audit history | 2 | outbox events exist; **no operator-facing audit export** |
| Notifications/integrations | 2 | none (no SMS/email/API integrations) |
| Backups/restore | 3 | scheduled backups; **restore drill pre-dates migrations 0013-0017** |
| Deployment/rollback | 3 | scp + scheduled task restart; **no canary, no tested rollback script** |
| Positioning shadow (PF-TIDE) | 3 | live diagnostics endpoint; not field-validated |

**Material finding (test evidence):** at audit time the full API suite
**fails** - first run `2 failed | 108 passed (110)`, rerun shows 7 suites
failing on tenant registration (500 INTERNAL). Last fully green full suite:
`102 passed` at 02:15 UTC today; targeted positioning+telemetry `13 passed` at
14:23. Root cause not yet diagnosed (local environment; read-only audit).
This is recorded, not repaired.

## 3. Commercial-gap assessment by segment

| Segment | Current process | Measurable cost | Would change if | Blocker |
|---|---|---|---|---|
| Local couriers (5-20 vans) | phone calls + spreadsheets + Google Maps | dispatcher hours; missed windows | dispatch time halves AND proof of delivery is audit-grade | no in-house IT; needs managed onboarding |
| Same-day operators | zone boards + driver WhatsApp | SLA failures, returns | live exceptions + customer ETA links | needs SMS/email notifications (absent) |
| Private medical transport | manual scheduling | missed appointments = reputational/compliance | on-time proof + retention (DPIA) | DPIA + patient-data controls required (absent) |
| Specimen/document couriers | paper manifests | chain-of-custody disputes | timestamped, signed evidence per stop | needs custodian sign-off + tamper proof (partial) |
| SME fleets (25-100) | legacy TMS or nothing | planning time, fuel | open source economics + self-host | needs SLA, support contract, multi-tenant ops |

No segment today has evidence PrivateFleet outperforms alternatives; that is a
pilot measurement task, not an engineering task.

## 4. Market alternatives (UK-relevant, published listings, unverified)

| Product | Model (published) | PrivateFleet has | Competitor has that we lack |
|---|---|---|---|
| [Onfleet](https://www.comparethecloud.net/articles/detrack-onfleet-or-routific-for-a-small-uk-courier) | ~US$500+/mo | POD, driver app, ETA | SMS/notifications, analytics suite, integrations |
| [Routific](https://www.routific.com/blog/routexl-alternatives) | ~$39-59/vehicle/mo | optimisation | customer ETA notifications, reports |
| [OptimoRoute](https://outmano.com/tools/optimoroute/pricing) | ~$35-60/user/mo | optimisation, POD | notifications, analytics, integrations |
| [Detrack](https://www.detrack.com/pricing/) | ~$29-49/vehicle/mo | POD, tracking | notifications, ERP integrations |
| [Circuit for Teams](https://getforgeworks.com/compare/circuit-for-teams-alternative.html) | ~$40/user/mo | driver-first | simplicity, push, low price |
| [Stream](https://go2stream.com/pricing/) (UK) | custom per-vehicle | UK transport focus | UK market presence, support org |
| [Zeo](https://apps.apple.com/cr/app/zeo-route-planner/id1525068524) | ~$11-30/user/mo | — | price (mass market) |
| [TrackFleet Dispatch](https://trackfleet.uk/dispatch.html) (UK) | custom | UK dispatch | UK support/sales |

Research date 2026-11-03; figures are published listings, not quotations.
**Genuinely defensible edges:** self-hosted/open-source economics, transactional
dispatch loop (policy revisions, stale rejection, baseline gate), honest
confidence-based positioning, single-tenant data ownership. **No defensible
edge** in notifications, integrations, analytics or support organisation -
the four things buyers ask for after the demo.

## 5. Technical production-readiness audit

- Dispatch correctness: strong core (visit-order regression tests, orphan
  invariant, policy gates). **Missing:** atomic assign+re-optimise, origin
  resolver, plain-language reasons, shift/time-window explanations.
- GPS/mobile reliability: provider flow stable; StationaryGate validated on
  Phone 1 (0 m drift, indoor). **Missing:** battery soak verdict, field
  accuracy evidence, PPK validation (base RINEX received, rover run pending).
- System reliability: healthz ok; outbox, RLS tested. **Failing:** full test
  suite at audit time; restore drill stale; no production alerting channel;
  no monitoring dashboards; no canary/rollback drill.
- Security/privacy: RLS + argon2 + keystore + FLAG_SECURE. **Missing:** DPIA,
  retention/deletion, cert pinning, dependency audit, access review, customer
  tracking token exposure review. Patient/health data would raise the DPIA and
  processing-bar requirements materially.

## 6. Customer deliverable assessment

Everything below still requires **developer intervention** today:
tenant creation (API only), driver onboarding (API + APK sideload - not on
Play Store), depot/policy config (UI exists, no guided setup), dispatcher
training (no materials), driver training (none), incident handling (no
runbook), support/escalation (none), data export (partial), offboarding
(none). Onboarding estimate: **1-2 developer days per customer**; support
burden estimate: **2-4 h/month** at pilot scale (estimates, not measured).

## 7. Commercial economics (estimates; development cost ≠ market value)

| Scale | Fixed infra/mo | Marginal/vehicle | Support h/mo | Notes |
|---|---|---|---|---|
| 10 vehicles | ~£0 (owned node) + support | ~£0 (OSRM/OpenFreeMap free) | 2-4 | messaging would add ~£0.04/SMS |
| 25 | ~£0-20 (power/backup) | ~£0 | 4-8 | needs alerting/monitoring |
| 50 | ~£20-60 + backup/DR | ~£0 | 8-12 | needs second node/HA decision |
| 100 | ~£60-150 + HA | ~£0 | 12-20 | needs ops automation + SLA staff |

External services that could break the model: SMS/email gateways, commercial
map/RTK licences (avoidable via OpenFreeMap/OSRM/OS Net), support labour.

## 8. Proof required for a £10,000 sale

Measured (requires a real operator): dispatcher planning minutes before/after,
on-time %, exceptions caught before the customer call, POD dispute closures,
GPS freshness/accuracy during real shifts. **None of these exist yet.**
Synthetic data cannot produce them. Required baseline sheet + 2-4 week pilot
with agreed success criteria.

## 9. Gap register (top items)

| # | Gap | Evidence | Impact | Risk | Work | Effort | Verify | Owner | Sales |
|---|---|---|---|---|---|---|---|---|---|
| 1 | No named operator/baseline/signed scope | docs/27 RED | no evidence | Critical | commercial | 1-2 wks | signed sheet | Operator | Blocks pilot |
| 2 | Full API suite failing at audit | 2/110 failed, rerun 7 suites 500 | CI unreliable | Critical | diagnose+gate | 1-2 d | green CI on merge | Developer | Blocks pilot |
| 3 | Restore drill stale | last drill pre-0013 | recovery unproven | Critical | run + time | 1 d | <10 min restore | Developer | Blocks pilot |
| 4 | No production alerting channel | local webhook only | silent failures | Critical | wire channel | 1 d | test alert delivered | Developer | Blocks pilot |
| 5 | Atomic assign+re-optimise missing | docs/27 4.2 | core promise broken | Critical | dispatch loop | 2-3 wks | assign adds stop +1 action | Developer | Blocks £10k |
| 6 | DPIA/retention absent | no artefact | legal blocker | Critical | external specialist | 1-2 wks | DPIA signed | External | Blocks pilot (medical) |
| 7 | No customer POD export/audit | stop_evidence only | POD claim weak | High | export PDF | 3-5 d | dispute replay | Developer | Blocks £10k |
| 8 | No notifications channel | none | exception value lost | High | SMS/email gateway | 1 wk | delay notify works | Developer | Blocks £10k |
| 9 | No self-serve onboarding/runbook | §6 | dev dependency | High | runbook+scripts | 1 wk | third-party can onboard | Developer | Blocks pilot scale |
| 10 | Field validation absent | §5 | accuracy unproven | High | PPK + A/B runs | 1-2 wks | scorecard published | Operator+Dev | Blocks £10k |
| 11 | No support/SLA/known-error KB | none | retention risk | Medium | 1-pager | 2 d | SLA accepted | Operator | P1 |
| 12 | Accessibility/security extras (pinning, dep audit, a11y pass) | absent | premium claim weak | Medium | packs | 1-2 wks | reports filed | Developer | P1 |
| 13 | HMM road matching, IMM, own RTK base, ML profiles | interfaces only | differentiation later | Low | defer | — | — | Developer | P2 |

## 10. Challenge of the previous five packs

1. **Closed dispatch loop** - genuinely needed for the first paying customer:
   it is the product's stated differentiator and currently missing. Minimum:
   assign + re-optimise with impact preview; postpone origin resolver and
   plain-language reasons to P1.
2. **Reliability/CI** - needed now; audit itself found a failing suite.
   Minimum: green CI gate, restore drill, alert channel. Canary later.
3. **Customer reporting/notifications** - notifications needed before a
   same-day/medical sale; scorecard can wait until pilot data exists.
4. **Security/compliance** - DPIA blocks medical verticals only; pinning and
   dependency audit can trail the first general-courier pilot.
5. **GPS positioning/validation** - PF-TIDE shadow is right-sized already;
   do NOT build IMM/HMM now. Field PPK validation is required before any
   accuracy claim, but the provider flow is already pilot-safe.

## 11. Verdict

A. **Maturity:** strong engineering pilot with real deployed functionality;
   not a handover-ready product; commercial evidence absent.
B. **Technical readiness: 3.4/5** (confidence high; core solver/tests strong,
   assurance layer incomplete and currently red).
C. **Commercial readiness: 1.5/5** (confidence high; zero customer evidence).
D. **Five reasons to buy:** self-hosted data ownership; real dispatch engine
   with policy gates; honest confidence-based tracking; open-source cost
   structure; single authoritative workflow for dispatch->POD.
E. **Five reasons to reject:** no pilot evidence; no notifications; no
   support/SLA organisation; onboarding needs the developer; no compliance
   artefacts (DPIA/retention).
F. **Top 10 gaps:** see §9 rows 1-10.
G. **Minimum for a £10,000 upfront contract:** rows 1-10 closed + one signed
   pilot with measured before/after + support terms drafted.
H. **Do NOT do yet:** IMM, HMM road-matching, own RTK base, ML device
   profiles, XLSX, multi-depot, Play Store branding, cloud migration.
I. **Customer evidence to obtain personally:** baseline metrics, buyer name,
   objections, competitor demo notes, willingness-to-pay.
J. **30/60/90:** 30 d = CI green + restore drill + alerting + POD export +
   design partner + field validation. 60 d = dispatch loop + DPIA + onboarding
   runbook + pilot live. 90 d = pilot review + scorecard + support terms +
   price decision.
K. **Go/no-go:** not ready for a paid pilot today; **not ready** for a £10,000
   implementation contract; **not ready** for a £10,000 annual contract.
   Realistic: ready to offer a paid pilot **in ~30 days** if §9 rows 1-4 and 7
   complete and an operator signs the baseline sheet.
