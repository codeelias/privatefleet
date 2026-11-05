# 54 - Competitive research reconciliation: what wins customer spend and trust

Date: 2026-11-05
Status: Wave 1 implemented and deployed 2026-11-05 (R1 idempotency reuse 409, R2 job timeline endpoint, R4 ETA window, R5 driver lifecycle). R3, R6-R15 remain backlog.

## Method

Four specialised research agents investigated how successful fleet and
delivery platforms win customer spend and trust through product design and
engineering (business model deliberately excluded): enterprise fleet,
last-mile dispatch, consumer-grade tracking trust, and reliability/trust
engineering. Sources are cited inline in each agent report; vendor-reported
metrics are treated as marketing claims, not facts.

## What the market says wins (condensed)

### Spend drivers (B2B operators)
1. **Routing quality that measurably cuts kilometres/hours** - the base ROI
   story (Routific 20-30% shorter routes; DispatchTrack "98% ETA accuracy").
2. **Dispatch ergonomics** - drag/drop, auto-dispatch, mid-day re-plan
   published to drivers (Routific plan/live dual mode, "Publish Changes").
3. **A driver app drivers actually use** - offline-capable, enforced POD,
   low training (Onfleet 4.8*; zero-install driver links).
4. **POD breadth** - photo, signature, barcode double-scan chain of custody,
   PIN, ID/age checks, required pre-close steps (Onfleet, Track-POD 7
   workflow variants).
5. **Automated customer comms + live ETA** - kills WISMO calls (Bringg: 30%
   fewer; Onfleet: 80%).
6. **Analytics** - on-time %, cost per stop, driver performance, exports.
7. **Integrations/API ecosystem** - webhooks, OpenAPI, marketplace.

### Trust drivers (customers)
1. Live map tracking + queue-position countdown ("2 stops away").
2. Delivery windows with escalating precision (1-hour -> 15-minute slot).
3. Photo proof at the doorstep.
4. Honest uncertainty: ETA as interval (Gopuff min/max), freshness
   indicators, "signal lost" states - never phantom precision.
5. Proactive notifications; in-flight control (reschedule/safe place).
6. Two-way courier contact; feedback loops.

### Trust engineering (both segments)
1. Third-party attestation (SOC 2 Type II, ISO 27001, HIPAA) - audit over
   time, not just design.
2. Idempotency keys + replay contracts on every mutating API.
3. Append-only audit/timeline records - disputes become evidence lookup.
4. Server-side geofenced completion with accuracy-aware skip + logging.
5. Offline-first with explicit degraded/offline states - no phantom live data.
6. Probabilistic ETAs: intervals, asymmetric loss (late worse than early).
7. Signed webhooks (HMAC over raw body, replay window, handshake, retry/
   disable contract).
8. Per-tenant rate limits with documented headers (429 as a contract).
9. Public status pages + published security/trust page.

## PrivateFleet: implemented vs gap

| Market capability | PF status | Notes |
|---|---|---|
| Live tracking + stops-away + ETA | DONE | public /track page: liveProgress stopsAway/etaMinutes + confidence |
| Photo/signature POD + timestamps | DONE | content-hashed, policy-gated (require photo/signature/recipient) |
| Offline-first driver app + command queue | DONE | idempotent command IDs, retry, sync state |
| Route optimisation (VROOM/OSRM) | DONE | fleet + per-driver, policies, revisions, 409 staleness |
| One active plan per driver (invariant) | DONE | docs/53 fix deployed |
| Geofence enter/exit + inside chip | DONE | states + overlays |
| Delivery confidence score | DONE | evidence-derived, 0-100 + factors |
| Dispatch board, heads-up, alerts | DONE | drag-drop assign + preview |
| Telemetry pipeline + stationary hold | DONE | PF-TIDE shadow, movement state |
| Readiness/health + socket reconnect | DONE | readyz DB probe, deterministic retry |
| **ETA as interval (min/max)** | GAP | we show point estimate + low/med/high confidence |
| **Proactive customer notifications (SMS/email)** | GAP | web page only |
| **Delivery windows w/ escalating precision** | PARTIAL | plannedArrivalAt exists; not surfaced as a customer window |
| **Customer sees POD photo** | GAP | counts only; media not exposed to token holder |
| **Geofenced completion gate** | GAP | can complete anywhere; Onfleet Warn/Block is the market norm |
| **Barcode double-scan / PIN / ID-age checks** | GAP | chain-of-custody breadth |
| **Auto-dispatch pool** | GAP | manual + preview only |
| **Mid-day re-plan published to drivers** | GAP | the domain of the docs/53 incident |
| **At-risk/late predictive flags** | PARTIAL | heads-up window warnings; no risk score |
| **Analytics: cost per stop, exports, driver perf** | PARTIAL | confidence + planned-vs-actual; no economics/export |
| **Append-only per-entity timeline API** | PARTIAL | outbox + job_events exist; not surfaced as timeline |
| **Idempotency at API edge (uniform + 409 contract)** | PARTIAL | commands/assign/import only; no request_log |
| **Signed outbound webhooks** | GAP | no webhook surface yet |
| **Per-tenant rate limits + 429 headers** | PARTIAL | auth/telemetry only |
| **Scoped API keys (domain x verb)** | GAP | staff token = full tenant |
| **Heartbeat staleness semantics (ONLINE/DEGRADED/OFFLINE)** | PARTIAL | stale flags; not a broadcast lifecycle |
| **Status page + security/trust page** | GAP | LAN-first today, but cheap and contractual |
| ELD/HOS, dashcams, fuel/maintenance, marketplace | NON-GOAL | courier SaaS positioning, not trucking |

## Recommended backlog (ranked by value/effort, engineering principles stated)

Each item lists: principle, mechanism, risk control. No implementation yet.

### Tier 1 - trust fundamentals (small, high leverage)

**R1. Idempotency at the API edge.** Uniform `Idempotency-Key` on all
mutating endpoints; `request_log(tenant_id, key, request_hash, response)`
with `UNIQUE(tenant_id, key)`; replay returns stored result; reuse with
different body -> 409 (DoorDash DashLink contract). Principle: exactly-once
semantics at the boundary; the outbox already assumes it internally.
Risk control: additive table; middleware opt-in per route.

**R2. Append-only per-entity timeline API.** Persist dispatched outbox
events into an immutable `event_log` (UPDATE/DELETE revoked from app role);
expose `/v1/jobs/:id/timeline` (created -> assigned -> arrived -> completed/
failed) for dispatcher, and a privacy-scoped version on the public tracking
page. Principle: event sourcing for dispute resolution (Track-POD timeline,
Onfleet Task History). Risk control: read-only views; outbox publisher
already serialises events.

**R3. Server-side geofenced completion with accuracy-aware skip.**
Complete/arrive validated against the stop location with per-tenant Warn/
Block policy; skip block when GPS accuracy is poor (log the reason); log
warn/block to the timeline (R2). Principle: proof credibility = the product
(Onfleet 200 m default, auto-skip on poor accuracy). Risk control: Warn mode
default (never blocks existing flows); config per tenant.

**R4. ETA as interval.** Replace/augment point ETA with `eta_min/eta_max`
derived from route-distance percentiles (start rule-based, per-tenant
historical leg times); keep `etaConfidence`. Principle: honest uncertainty
beats overconfident point estimates (DoorDash: inconsistent ETAs undermine
trust). Risk control: additive field; UI renders "between X and Y".

**R5. Heartbeat-derived driver lifecycle.** ONLINE/DEGRADED/OFFLINE from
heartbeat/telemetry freshness with per-tenant delay; broadcast to dispatcher
(socket) and show `position_age` on customer page (exists partially).
Principle: never phantom-live data (Onfleet offline = connectivity rule).
Risk control: display-only states; thresholds configurable.

### Tier 2 - customer-experience wins

**R6. Proactive notifications with consent + opt-out.** Event-driven SMS/
email on dispatched/arriving/N-stops-away/delivered; consent required
(Routific model). Requires an SMS/email transport (self-hosted SMTP first).
Principle: lifecycle events are already in the outbox; fan-out is an
adapter. Risk control: provider-agnostic adapter; consent flag.

**R7. POD photo to the customer (token-scoped).** Expose the proof photo(s)
on the public tracking page under the existing hashed token. Principle:
doorstep proof is the strongest trust signal (Amazon Photo on Delivery).
Risk control: only via the unguessable token; no other media exposed.

**R8. Delivery window with escalating precision.** Customer-facing window
(planned arrival +/- margin) narrowing to a 15-minute slot near arrival
(DPD model) using R4 intervals. Risk control: window display only; never
guarantee wording.

### Tier 3 - operations depth

**R9. Mid-day re-plan with driver publish.** Dispatcher re-optimises
un-finished work and publishes; drivers receive the new plan explicitly
(versioned), replacing the plan atomically - guarded by the docs/53
one-active-plan invariant. Principle: the incident we just fixed defined
the contract (plan = newest version; supersede all older). Risk control:
build on R1 idempotency + version 409; supersede per-driver.

**R10. At-risk scoring.** Derive per-stop risk from remaining distance vs
window close (we already compute both); score + heads-up chip. Principle:
intervene before the customer notices (Onfleet at-risk flags). Risk
control: display + alert only, no auto-actions.

**R11. Analytics pack.** On-time %, planned-vs-actual, cost-per-stop (from
distance + service time), driver performance, CSV export. Principle:
contract-renewal evidence (Onfleet Courier Suite framing). Risk control:
read-only aggregation over existing events.

### Tier 4 - platform/enterprise readiness

**R12. Signed webhooks + replay window.** HMAC-SHA256 over raw body with
timestamp window + dual-signature rotation (Routific/Gopuff model) when an
integration surface exists. Principle: integrations must be verifiable.
Risk control: feature-flagged; docs before code.

**R13. Scoped API keys (tenant + subset + verb).** Key metadata enforced in
the auth hook + RLS. Principle: least privilege for multi-tenant (Track-POD
restricted access). Risk control: additive; existing staff tokens unaffected.

**R14. Per-tenant rate limits with documented 429 headers.** Token bucket
per tenant; `X-RateLimit-Limit/Remaining`; guidance "prefer webhooks".
Principle: noisy-neighbour fairness; SOC 2 Availability control evidence.
Risk control: generous defaults; documented contract.

**R15. Status page + security/trust page.** Uptime + incident history +
published controls (encryption, retention, access model, attestation
roadmap). Principle: procurement surface (Trimble/Fleetio trust portals).
Risk control: informational only.

## Explicit non-goals (documented to prevent scope creep)

- ELD/HOS compliance, AI dashcams, fuel cards, heavy-asset maintenance -
  trucking-segment features; PrivateFleet is last-mile courier SaaS.
- Generative AI agents over fleet data - vendor claims are unverifiable;
  unjustifiable for a synthetic-data LAN product.
- Marketplace/carrier networks - business-model territory, excluded by the
  brief.

## Sequencing when approved

```text
Wave 1 (trust fundamentals):  R1 -> R2 -> R3 -> R4 -> R5
Wave 2 (customer wins):       R6 -> R7 -> R8
Wave 3 (operations depth):    R9 -> R10 -> R11
Wave 4 (platform readiness):  R12 -> R13 -> R14 -> R15
```

Each item: separate commit, unit/integration tests, gate green, reversible
schema (additive only), no cross-module destabilisation - the same discipline
applied to the docs/53 fix.
