# 01 - Vision & Principles

**Status:** Draft v1 - for approval.
**Applies to:** every document in this package.

## 1.1 What we are building

A **white-label fleet operations system** for local mid-sized operators (couriers and delivery fleets first, private medical transport once a design partner exists). It is not a GPS tracker and not a generic delivery app.

The central value proposition:

> Give a dispatcher one place to plan work, assign drivers, detect delays, adapt routes, and provide customers with reliable service updates.

The commercial framing from the sales blueprint remains valid: the buyer is purchasing *operational relief* - the feeling that the operation is under control - demonstrated by an interactive demo (the **Honey Pot**), then justified by measurable results in a pilot. The engineering goal of this documentation is to make that demo real and to make the pilot safe.

## 1.1b The emotional ROI - why software fails without empathy

Dispatchers and drivers do not care about our tech stack; they care about their daily emotional state. Software that feels like a cold spreadsheet dies from lack of adoption no matter how good the architecture is. We design for three human states, and every screen in this documentation names the state it serves:

| Person | Current state | State we sell | How the product delivers it |
|--------|---------------|---------------|------------------------------|
| **The Owner** | Anxiety - one missed transport or delayed delivery could lose the biggest client | **Confidence** | The "God View" answers "is anything on fire?" in under two seconds; exceptions surface before the customer calls ([05](05-web-app-architecture.md)) |
| **The Dispatcher** | Overwhelm - a whiteboard, three phones, group texts | **Control** | A calm, uncluttered command center; drag-and-drop that feels tactile and decisive, with impact previews that remove the fear of mistakes ([05.1b](05-web-app-architecture.md)) |
| **The Driver** | Frustration - confusing instructions, blamed for delays | **Empowerment** | A glanceable, one-handed co-pilot that always answers "what is my next step?" and never loses their work offline ([06.1b](06-driver-app-architecture.md)) |

**Design non-negotiable: every technical feature must map to an emotional outcome.** Examples:

- *Technical:* transactional outbox + WebSocket delivery. *Emotional:* the dispatcher never has to say "let me call the driver and call you back" - they just look at the screen.
- *Technical:* offline command queue with explicit conflicts. *Emotional:* a driver in a dead zone never fears losing their progress - and is never blamed for a stale state they didn't cause.
- *Technical:* impact preview before assignment. *Emotional:* the prospect feels safe to click, because the system shows the consequence before the commitment.

This mapping is itself a design principle: a feature that cannot state its emotional outcome in one sentence is not ready to be built.

## 1.2 Market sequencing

| Order | Vertical | Why |
|-------|----------|-----|
| 1 | Local courier & delivery operators | Fewer compliance barriers, fast pilot, clear ROI metrics (stops/day, on-time %, exceptions/day). |
| 2 | Private medical transport | Strongest pricing power and the POD/compliance story sells well, but requires a design partner and a data-protection gate (see [11](11-security-and-compliance.md)) before any patient data is handled. |

We do **not** build both sets of domain requirements simultaneously. The schema and modules are shaped so the second vertical is a configuration and compliance exercise, not a rewrite.

## 1.3 Commercial packaging boundary (engineering view)

- The default commercial product is a **licence + implementation package**: one branded deployment, agreed workflow scope, configuration, onboarding, acceptance criteria, a defined support period, and separately stated recurring infrastructure/support terms.
- **Payment does not automatically transfer source code, IP, or infrastructure.** Source-code or IP transfer is a separately negotiated product. Our engineering work never depends on which deal is signed, but the contract must be explicit about it.
- The $10,000 price is a hypothesis to validate with the market, not a guaranteed outcome of a polished demo.

## 1.3b The white-label revenue multiplier (the buyer's ROI)

We are not only selling operational efficiency (time and fuel saved); we are selling a **premium brand asset**. Local mid-sized operators' biggest fear is being treated as a commodity. A fully branded tracking page with their logo, colors, and voice lets them charge their end-customers a premium - and look like a national enterprise while doing it.

- *The pitch:* "You aren't just buying software to dispatch vans. You're buying a platform that makes your 10-van fleet look like a national enterprise - you can charge a premium per delivery just by sending this branded tracking link."
- **Engineering impact (what this decision demands):**
  - `tenants.branding` drives a **constrained token set** - logo, colors, fonts, brand name - applied to the dispatcher UI, the tracking page, and notification templates ([05.7](05-web-app-architecture.md)).
  - White-label **email/SMS dispatch templates** per tenant ([05.3b](05-web-app-architecture.md), Phase 6).
  - Verified **custom-domain routing** so the tracking page serves from the tenant's own domain ([11.5](11-security-and-compliance.md), Phase 6).
  - Deliberately **not** supported: arbitrary CSS/JS injection from tenant configuration. Tokens, not code - untrusted styling is an XSS and maintenance liability; the token set delivers the branding value without the risk ([11.1](11-security-and-compliance.md)).

## 1.4 The demo is a production slice

The Honey Pot is not a throwaway mock. Phase 1 builds the **real** dispatcher dashboard and driver app against the **real** API architecture, running with in-memory repositories, seeded scenarios, and simulated GPS. The demo therefore exercises the production event pipeline (outbox -> Socket.IO -> UI) from day one. See [ADR-0007](adr/0007-demo-strategy.md) and [14 - Roadmap & Gates](14-roadmap-and-gates.md).

The demo shows what is simulated and what is implemented, and never presents fabricated savings as verified results.

## 1.5 Engineering principles

These are the non-negotiables. Every design document derives from them.

1. **One shared operational model.** The dispatcher, driver, and customer views are projections of one domain model (jobs, stops, routes, vehicles, events), not three separate data models.
2. **Server-authoritative everywhere.** The API validates every command against current state. Clients may show optimistic intent, but only the server decides outcomes, versions, and transitions.
3. **Contracts first.** API and event shapes are defined once in `packages/contracts` (zod + TypeScript) and consumed by web, driver, and API with full type safety.
4. **Persist, then publish.** A state change is only announced after its database transaction commits (transactional outbox). Sockets deliver; the database stores.
5. **Tenant isolation is a design invariant, not a feature.** Enforced in the app layer, the schema (composite keys), and the database (row-level security) - three independent layers.
6. **Lightweight by default, modular by construction.** A modular monolith in a monorepo: YAGNI where possible, but every module boundary is real and extractable. No microservices, no distributed transactions, no premature queues.
7. **Boring, proven technology.** Established, well-documented open-source components. Novelty is allowed only where it directly serves a demo moment or a customer metric.
8. **Tests are executable specifications.** The three demo scenarios become Playwright acceptance tests; the hardening scenarios (duplicate commands, out-of-order GPS, cross-tenant probes, restore drills) become integration tests.
9. **Docs-as-code, decisions recorded.** Documentation and ADRs live in the repo and change in the same PR as the code.
10. **Observe from day one.** Structured logs with request IDs, event/outbox health, and the metrics a dispatcher would want are available in the demo, not added "later".

## 1.6 Non-goals for the first commercial release

- Real-time traffic prediction (road-network-based estimates only, labelled as such).
- Marketing claims of "AI" for a constraint solver (VROOM is optimization, not AI).
- Microservices, Kubernetes, or multi-region deployments.
- Multi-language UI (English first; i18n only when a tenant demands it).
- Custom native iOS/Android work beyond Expo's managed workflow.
- Medical-transport data processing before the compliance gate in [11.6](11-security-and-compliance.md) is met.

## 1.7 Measurable outcome anchor

The first commercial milestone is **not** "all features finished". It is:

> A prospective operator recognises their own operational problem in the demo, agrees on measurable success criteria (e.g., stops/day, on-time %, exceptions caught before the customer calls), and commits to a properly scoped pilot.

Every phase gate in [14 - Roadmap & Gates](14-roadmap-and-gates.md) exists to move toward that milestone without fake progress.



