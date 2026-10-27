# Open Decisions - Approved

**Status: APPROVED - 2026-10-27.** All 21 decisions (A7/B5/C4/D5) approved; all 11 ADRs accepted. Q1 (driver theme) resolved: **light** ([ui-ux-handoff](figma/ui-ux-handoff.md) Section 12). No open items remain - this file is now the approval record.

## Approval record

| Item | Outcome |
|------|---------|
| Date | 2026-10-27 |
| Sign-off | Formal approval of the v1.4 package as the frozen build contract for Phase 1 |
| ADRs | All 11 flipped to `accepted` (0001-0011) |
| Decisions | All 21 approved (A1-A7, B1-B5, C1-C4, D1-D5) |
| Q1 driver theme | Resolved: **light** (`#F8FAFC` / `#FFFFFF`); the three Figma driver frames are updated in Figma before any driver-screen code |
| Q2 portal primary | Resolved: `#2563EB` fallback; tenant theme wins when configured |
| Q3 build timing | Amended 2026-10-27 by owner directive: Phase 0 parked as a parallel commercial track; Phase 1 proceeds (CHANGELOG v1.8) |
| Housekeeping | Figma token `figd_07-MZ...` must be revoked by the account owner in Figma -> Settings -> Security |

## A. Architecture decisions

| # | Decision | Recommendation | Why it matters |
|---|----------|----------------|----------------|
| A1 | **Monorepo** (pnpm + Turborepo): `apps/{api,web,driver}` + `packages/{contracts,eslint-config,tsconfig}` | [x] Approve | One PR changes a contract and both consumers atomically; single toolchain for a small team. |
| A2 | **Modular monolith** (not microservices), extractable modules | [x] Approve | One transaction per workflow, one deployable, zero distributed-systems tax until metrics justify it. |
| A3 | **Contracts-first** shared package (zod + TS types as the single source of truth) | [x] Approve | Type drift between web/driver/API is eliminated at compile time. |
| A4 | **Backend:** Fastify + Drizzle ORM (raw SQL for PostGIS) + PostgreSQL/PostGIS + RLS | [x] Approve | Schema-first validation; Drizzle avoids Prisma's weight while keeping typed queries; RLS is the third isolation layer. |
| A5 | **Web:** React + Vite + TanStack Router/Query + Zustand + Tailwind (shadcn-style) + dnd-kit + MapLibre GL JS | [x] Approve | Modern, lightweight, battle-tested; matches the dark ops-center aesthetic of the reference screenshots. |
| A6 | **Driver app:** one Expo codebase from day one - web target for the demo, native for the pilot (no separate PWA) | [x] Approve | Driver UI written once; demo driver screens are the real ones. |
| A7 | **Realtime:** transactional outbox for business events + direct socket path for GPS telemetry, snapshot recovery on reconnect | [x] Approve | Never lose a state change; never choke the outbox on ping volume. |

## B. Product & demo decisions

| # | Decision | Recommendation | Why it matters |
|---|----------|----------------|----------------|
| B1 | **Demo = production API with in-memory repos + GPS simulator** (not a frontend-only mock) | [x] Approve | The demo exercises the real event pipeline; nothing thrown away; two devices stay in sync. |
| B2 | **Map tiles:** OpenFreeMap for demo/dev, decision reviewed at real traffic | [x] Approve | Zero tile cost through the pilot; keeps the "no Google Maps tax" story honest. |
| B3 | **Vertical sequencing:** courier/delivery operators first; private medical transport only after a design partner + the data-protection gate | [x] Approve | Fast pilot and clear ROI first; medical transport needs a DPIA and Article 9 basis before any patient data. |
| B4 | **Commercial scope:** licence + implementation package by default; source-code/IP transfer is a separately negotiated product | [x] Approve | Prevents the "$10k = they own everything" misunderstanding from either side. |
| B5 | **Optimization honesty:** VROOM is a constraint solver, not "AI"; demo savings banners use seeded, labelled results until live OSRM/VROOM is configured | [x] Approve | Protects credibility when the prospect digs in. |

## C. Process decisions

| # | Decision | Recommendation | Why it matters |
|---|----------|----------------|----------------|
| C1 | **Methodology:** trunk-based development, Conventional Commits, PRs <= ~400 lines, ADRs, docs-as-code | [x] Approve | Small reversible changes; decisions that outlive authors. |
| C2 | **Testing:** demo scenarios as Playwright acceptance tests + the 9 hardening scenarios as integration tests + contract snapshot tests | [x] Approve | The gates in the roadmap become automated, not ceremonial. |
| C3 | **CI:** GitHub Actions (lint -> typecheck -> unit -> integration -> build -> e2e) with changesets for releases | [x] Approve / confirm repo host | Assumes the repo will live on GitHub; say otherwise and the pipeline spec is host-agnostic. |
| C4 | **Phase gates as progress, not dates** (0 Validate -> 1 Demo -> 2 Backend -> 3 Driver -> 4 Tracking -> 5 Optimization -> 6 Pilot hardening) | [x] Approve | Every phase has a hard exit gate that means something commercially. |

## D. Experience & sales layer (added in v1.1)

| # | Decision | Recommendation | Why it matters |
|---|----------|----------------|----------------|
| D1 | **Emotional design is a design non-negotiable:** every screen names the human state it serves (owner -> confidence, dispatcher -> control, driver -> empowerment); the dispatcher UI follows the "Calm Command Center" language; the driver app follows glanceable/thumb-zone rules; the 120-second demo is scripted and rehearsed ([01.1b](01-vision-and-principles.md), [05.1b](05-web-app-architecture.md), [06.1b](06-driver-app-architecture.md), [14.2b](14-roadmap-and-gates.md)) | [x] Approve | Adoption dies without empathy; this is the layer that converts the demo into the $10k close. |
| D2 | **Empathetic error handling:** no raw API errors in the UI; every error carries a conversational `uiMessage` with a concrete next step ([ADR-0011](adr/0011-empathetic-error-handling.md)) | [x] Approve | Graceful failure builds pilot-phase trust and reduces support calls. |
| D3 | **Customer Tracking Portal (Screen 5) as a premium revenue driver:** designed for the buyer's end-customers to justify premium pricing, not just operational visibility ([01.3b](01-vision-and-principles.md), [05.3b](05-web-app-architecture.md)) | [x] Approve | Transforms the pitch from "efficiency software" to "brand and revenue infrastructure". |
| D4 | **48-hour sandbox access:** prospects receive a branded, time-limited sandbox environment immediately following the pitch ([14.2c](14-roadmap-and-gates.md)) | [x] Approve | Extends the demo's emotional impact into their weekend; faster close. |
| D5 | **Context-aware seed data:** demo environments are seeded with vertical-specific, localized data - courier vs. medical, London vs. Manchester ([12.6b](12-testing-and-quality.md)) | [x] Approve | Eliminates the "canned demo" feel; the prospect visualizes their actual business. |

## How to approve

Reply with one of:

- **"Approve all"** - everything above is accepted as-is; ADRs flip to `accepted` and Phase 0 starts.
- **"Approve all except B2 / A5 / ..."** with your changes - I'll revise the affected documents and ADRs and resubmit.
- **"Let's discuss X first"** - I'll prepare a focused comparison for that item before you decide.

## What happens after approval

1. ADR statuses are updated to `accepted` and this file is trimmed to remaining open items.
2. Phase 0 (Validate) kicks off: vertical shortlist, target-operator workflow notes, baseline metrics, licence scope.
3. Phase 1 (Demo) begins only after Phase 0's gate - with the scaffold matching [03](03-monorepo-layout.md) exactly and the first PRs implementing [12.2](12-testing-and-quality.md)'s scenario tests alongside the screens.

Nothing is built until you approve this package.







