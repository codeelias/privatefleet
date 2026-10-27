# 14 - Roadmap & Gates

**Status:** Draft v1 - for approval.
**Related:** [01.4](01-vision-and-principles.md) (demo philosophy), [12.2](12-testing-and-quality.md) (scenario tests).

Effort estimates are a planning hypothesis, not a delivery guarantee - a production driver app, background GPS, security testing, and optimization can expand once the design partner's real requirements are known. Gates, not dates, decide progress.

## 14.1 Phase table

| Phase | Primary work | Exit gate (hard) |
|-------|--------------|------------------|
| **0. Validate** | Select vertical + first prospects; document a real dispatcher workflow; agree baseline metrics (stops/day, on-time %, exceptions caught); fix the licence/implementation scope | A named design partner validates the problem and success metrics |
| **1. Demo (Honey Pot)** | Monorepo scaffold; contracts package; Fastify modular skeleton with in-memory repos; the 8 screens (5 dispatcher + 3 driver) against the real API; simulator; seeded scenarios; Playwright E2E of the three scenarios | The 120-second demo runs repeatedly, hands-free, on a tablet handed to a prospect; E2E green; "new dev in 15 min" instructions work |
| **2. Backend** | PostgreSQL/PostGIS migrations; auth (JWT + refresh); RLS + composite keys; server-authoritative job lifecycle; command idempotency; transactional outbox | Security + lifecycle integration tests pass, including cross-tenant probes on all three layers |
| **3. Driver workflow** | Native Expo build; real assignments; job actions; offline command queue + conflict handling | A real driver completes a real job; the dispatcher sees authorized updates without refresh |
| **4. Live tracking** | GPS ingestion; hot/cold position split; outbox publisher hardening; Socket.IO rooms + snapshot recovery; staleness handling | Live map works in the field; tracking edge-case tests pass ([12.3](12-testing-and-quality.md) #1-3) |
| **5. Optimization** | OSRM matrix + VROOM solve; adapters; proposal/approval flow; route versioning | Infeasible plans surface correctly; approved plans publish without conflicts; demo banners cite stored `optimization_runs` |
| **6. Pilot hardening** | Customer tracking + POD vault; alerts/geofences; backups + restore drill; deployment automation; retention; branded subdomains; support runbooks | Acceptance tests, recovery tests, and the monthly restore drill pass; tenant provisioning is scripted |

### 14.1b Phase 0 disposition (owner directive, amended 2026-10-27)

Phase 0 is **not** a parallel track - it is the immediate next commercial action and the entire reason the product exists. Phase 1 code shipped first by owner directive; from v1.11 onward the active blocking task is the **120-second rehearsal** ([14.2b](#142b-the-120-second-honey-pot-sales-script)), followed by putting the demo in front of a real courier or medical transport owner. The explicit prospect yes gates Phase 2 - nothing else does. Recorded in CHANGELOG v1.12.

## 14.2 Phase 1 scope detail (the demo)

- **Built for real:** the five dispatcher screens ([05.3](05-web-app-architecture.md)) and three driver screens ([06.3](06-driver-app-architecture.md)), the API with in-memory repositories, outbox -> Socket.IO pipeline, simulator, scenario reset, demo auth.
- **Deliberately deferred:** real Postgres persistence (Phase 2), native driver builds and offline queue (Phase 3), real GPS (Phase 4), live OSRM/VROOM (Phase 5; demo uses seeded, labelled proposals unless containers are configured), customer-facing public page (Phase 6; the dispatcher-side preview exists).
- **Non-negotiable:** the drag-assign -> impact preview -> confirm -> event cascade interaction is the production command path, not a mock animation ([ADR-0007](adr/0007-demo-strategy.md)).
- **Demo resilience:** the demo stack must also run entirely on local hardware (laptop + tablet on the same LAN) with no dependency on venue WiFi or the public internet - a dead connection must never be able to kill a pitch. One command boots the stack; reconnection recovers via the snapshot path ([09.7](09-realtime-tracking.md)).

### The 120-second script -> screens

| 0-15 s The pain | 15-40 s The drag-assign | 40-65 s Optimization | 65-90 s Driver proof | 90-120 s Customer + close |
|---|---|---|---|---|
| Live map, 8 jobs queued, 1 visible delay | Prospect drags STAT job; Smart Gap preview; commit | Optimize Morning Rush; labelled delta banner | Tablet: Arrived/complete with signature; dashboard updates live | Tracking preview; connect to their operation |

## 14.2b The 120-second "Honey Pot" sales script

The demo is scripted like a theatrical play - the prospect is guided through one story that hits their pain points, never left to click randomly. Pacing is a design deliverable, rehearsed at every phase gate alongside the E2E tests ([12.2](12-testing-and-quality.md)).

1. **0-15 s - The Pain (Live Map).** "Look at this: eight jobs queued, one running late. Right now you'd find this out by making three phone calls. Here, it's just red on the map."
2. **15-40 s - The Magic (Drag & Drop).** Hand the prospect the mouse. "A STAT pickup just came in. Drag this red job card onto the closest driver. See the impact preview? It tells you exactly how this affects their day *before* you commit." They click Confirm. The map redraws instantly.
3. **40-65 s - The Value (Optimization).** "Now click Optimize. The engine re-sequences the stops - watch the delta banner. That's fuel and hours coming off the board, and a driver getting home on time."
4. **65-90 s - The Trust (Driver Proof).** Pick up the tablet. "Here's what the driver sees: one big button, slide to arrive. Look at the big screen - the dispatcher just saw it update live."
5. **90-120 s - The Close (White-Label).** Open the customer tracking preview. "When the client opens this link they see *your* logo, *your* brand, and an exact ETA. You look like a million-dollar enterprise."

**Presenter's honesty rule:** quote concrete savings figures only when they come from a stored `optimization_runs` result on the demo's seeded dataset - and say so ("on this demo dataset"). Never present fabricated or unverified savings as real business results ([01.4](01-vision-and-principles.md), [10.4](10-optimization-integration.md)). The emotional power of the demo does not depend on fake numbers - the prospect *feeling control* is the sale.

## 14.2c The 48-hour close strategy

The demo does not end when the tablet is handed back. The emotional high is followed immediately by a frictionless commercial close:

1. **The leave-behind PDF.** A bespoke one-page ROI summary computed from the prospect's own baseline metrics - "If you save 15 minutes per driver per day across 10 drivers, that's ~GBP 12,000 a year" - with every assumption visible on the page. Figures are derived from *their* inputs, never invented ([01.4](01-vision-and-principles.md)).
2. **The sandbox access.** Never leave a brochure; leave a private, time-limited URL (48-72 h) to the Honey Pot with **their logo already uploaded**. Engineering consequence: the demo module provisions per-prospect branded sandboxes with expiry and reset ([12.6b](12-testing-and-quality.md), [15.3](15-infrastructure-and-deployment.md)).
3. **The pilot contract.** Have the licence agreement and Phase 0/1 scope ready to sign, framed as: "The $10k secures the build of your branded platform. You aren't buying a licence - you're commissioning an asset." The contract still states the licence/implementation scope explicitly ([01.3](01-vision-and-principles.md)) - the framing sells; the terms stay honest.

## 14.3 Non-goals per phase (explicit)

- **Phase 1:** no persistence, no real auth beyond demo tokens, no native builds, no traffic data, no billing.
- **Phase 2:** no optimization, no background GPS, no custom domains.
- **Phases 3-5:** no multi-region, no multi-instance API, no OTA updates, no public custom domains.
- **Phase 6:** no medical-transport data until the [11.6](11-security-and-compliance.md) gate passes - it is a separate work package, not a Phase 6 checkbox.

## 14.4 Risk register (top items)

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Demo over-engineered, misses the sale window | Medium | Phase 1 fixed scope above; weekly checkpoints; everything demo-visible is production code, so nothing is wasted |
| Tile/map costs or ToS surprises | Medium | [ADR-0010](adr/0010-map-tiles.md): OpenFreeMap start, provider decision recorded, revisit at traffic |
| Offline driver conflicts erode trust | Medium | Server-authoritative sync with explicit conflicts ([06.4](06-driver-app-architecture.md)); hardening tests #5 |
| Scope creep into "enterprise" features | High | Non-goals per phase; ADR gate for new dependency classes |
| Background GPS platform limits | High (Phase 4) | Expectation-setting with pilot; foreground-first; documented platform behaviour |
| Medical-transport compliance | High (that vertical) | Hard gate + DPIA + design partner before any patient data |
| Solo/small team bus factor | Medium | Docs-as-code, ADRs, pairing on sensitive code, automated gates |
| The $10k hypothesis itself | High | Phase 0 validation before heavy Phase 2+ investment; licence scope explicit in contract |

## 14.5 The first commercial milestone

> A prospective operator recognises their own operational problem in the demo, agrees on measurable success criteria, and commits to a properly scoped pilot.

Phases 1-2 serve that milestone directly; Phases 3-6 serve the pilot and the repeatable product.




