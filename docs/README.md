# PrivateFleet - Engineering Documentation

Working title for the white-label fleet dispatch & tracking platform.

**Status: v1.4 - APPROVED 2026-10-27.** The package is the frozen build contract for Phase 1: 11 ADRs accepted, all 21 decisions approved, driver theme resolved to light. No application code exists yet, and none will be written until the Phase 0 gate passes (a named design partner says yes) per [14](14-roadmap-and-gates.md).

## How to use this package

1. Start with [01 - Vision & Principles](01-vision-and-principles.md) (what we build and what we refuse to compromise on).
2. Read [02 - Architecture Overview](02-architecture-overview.md) (the whole system on one page).
3. Read the subsystem designs in order: [03](03-monorepo-layout.md) -> [04](04-backend-architecture.md) -> [05](05-web-app-architecture.md) -> [06](06-driver-app-architecture.md) -> [07](07-database-design.md) -> [08](08-domain-model-and-events.md) -> [09](09-realtime-tracking.md) -> [10](10-optimization-integration.md) -> [11](11-security-and-compliance.md).
4. Read the process documents: [12](12-testing-and-quality.md), [13](13-development-methodology.md), [14](14-roadmap-and-gates.md), [15](15-infrastructure-and-deployment.md).
5. Decisions with rationale live in [adr/](adr/README.md). Items that need **your sign-off** are collected in [open-decisions.md](open-decisions.md).

## Document map

| # | Document | Answers |
|---|----------|---------|
| 01 | [Vision & Principles](01-vision-and-principles.md) | What are we building, for whom, and what is non-negotiable? |
| 02 | [Architecture Overview](02-architecture-overview.md) | System context, containers, runtime flows, deployment topology. |
| 03 | [Monorepo Layout](03-monorepo-layout.md) | Workspace structure, packages, dependency rules, tooling. |
| 04 | [Backend Architecture](04-backend-architecture.md) | Modular monolith design, module anatomy, API/error/event conventions. |
| 05 | [Web App Architecture](05-web-app-architecture.md) | Dispatcher dashboard design, state strategy, map, white-label theming. |
| 06 | [Driver App Architecture](06-driver-app-architecture.md) | Expo app, offline command queue, sync and conflict protocol. |
| 07 | [Database Design](07-database-design.md) | Full schema, conventions, RLS, migrations, retention. |
| 08 | [Domain Model & Events](08-domain-model-and-events.md) | Aggregates, state machines, invariants, event catalog, idempotency. |
| 09 | [Real-Time Tracking](09-realtime-tracking.md) | GPS ingestion, outbox, socket rooms, recovery, geofencing. |
| 10 | [Optimization Integration](10-optimization-integration.md) | OSRM + VROOM workflow, adapters, proposal approval flow. |
| 11 | [Security & Compliance](11-security-and-compliance.md) | Threat model, tenant isolation, tracking tokens, data protection. |
| 12 | [Testing & Quality](12-testing-and-quality.md) | Test strategy, CI gates, the hardening scenarios as executable tests. |
| 13 | [Development Methodology](13-development-methodology.md) | Git workflow, PRs, DoD, ADR process, releases, cadence. |
| 14 | [Roadmap & Gates](14-roadmap-and-gates.md) | Phases 0-6 with entry/exit gates, non-goals, risks. |
| 15 | [Infrastructure & Deployment](15-infrastructure-and-deployment.md) | Environments, Compose services, backups, costs. |
| - | [adr/](adr/README.md) | Architecture Decision Records - why each significant decision was made. |
| - | [CHANGELOG.md](CHANGELOG.md) | Version history and the re-runnable verification checks. |
| - | [open-decisions.md](open-decisions.md) | Items awaiting your approval, with recommendations. |

## Glossary

- **Honey Pot** - the interactive sales demo and the name of the Phase 1 milestone: a live sandbox where a prospect performs a real dispatch workflow.
- **Tenant (org)** - one white-label customer. Every row of tenant-owned data carries `tenant_id`.
- **Module** - a vertically sliced unit of the backend owning one business capability end-to-end (routes, domain logic, persistence, events, tests).
- **Contract** - a shared TypeScript/zod definition of an API request/response or event payload, published from `packages/contracts`.
- **Outbox** - a database table of pending events written in the *same transaction* as the state change, drained by a background publisher. Guarantees that committed changes are eventually delivered.
- **Telemetry** - high-frequency GPS data. Fast path, tolerant of loss; recovery is by snapshot.
- **Business event** - a state change that must not be lost. Always travels through the outbox.
- **Vertical slice** - a change delivered end-to-end through one capability, not one architectural layer.
- **Design partner** - the first real customer who co-validates the pilot against their live operation.
- **Emotional ROI** - the mapping from every technical feature to the human state it improves (owner -> confidence, dispatcher -> control, driver -> empowerment); a feature without one is not ready to build ([01.1b](01-vision-and-principles.md)).
- **Calm Command Center** - the dispatcher UI design language: dark, high-contrast, ambient awareness, impact previews, empathetic micro-copy ([05.1b](05-web-app-architecture.md)).
- **uiMessage** - the conversational, next-step error copy shipped with every API error; the only error field clients may render ([ADR-0011](adr/0011-empathetic-error-handling.md)).
- **Server-authoritative** - the API validates every command against current state; clients never decide outcomes locally.

## Design references

The primary visual source is the Figma master design **`Fleet Operations - UI UX Master Design`** (file `fnFeIyZr87XvelShaqyIVz`). Its extracted tokens, per-screen content, and normative micro-copy are documented in [figma/design-extract.md](figma/design-extract.md); the implementation handoff (screen contracts, tokens, theming, React structure mapping, acceptance checklist) is integrated at [figma/ui-ux-handoff.md](figma/ui-ux-handoff.md). The Figma design supersedes the older static screenshots wherever they differ. `../screenshot/` contains those earlier references: `dashboard.jpg` (dark operations command center), `Dispatch Board.jpg` (driver-lane timeline), `Route Optimisation.jpg` (split comparison workbench), `Exceptions and Performance.jpg` (alert console), `Jobs and Work Orders.jpg`, `Today and Route.jpg` (driver queue), `Active Job.jpg` (driver execution), `Completion  Exceptions.jpg` (POD/signature). The web app design in [05](05-web-app-architecture.md) maps each screen to both sources.

## How these documents are maintained

- Docs live in the monorepo under `docs/` and are reviewed in the same PR that changes behaviour.
- A PR that changes an interface, state machine, or database shape **must** update the relevant document in the same PR.
- Significant decisions are recorded in `docs/adr/`; a code change that contradicts a recorded decision must first supersede that ADR.
- The [open-decisions.md](open-decisions.md) list shrinks as you approve items; approved items become ADRs or move into the main documents.



