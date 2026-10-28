# UI/UX Engineering Handoff - Integrated

**Source:** user-provided handoff document ("Fleet Operations SaaS - UI/UX Handoff") + the Figma master design (`fnFeIyZr87XvelShaqyIVz`), extracted into [design-extract.md](design-extract.md).
**Status:** Draft v1.4 - integrated into the documentation package. This document is normative for Phase 1; where it conflicts with the Figma extraction or earlier documents, see [Section 11 Reconciliation](#11-reconciliation-deltas) and [Section 12 Open questions](#12-open-questions-for-sign-off).

## 1. Design intent (quoted, normative)

> Design for operational clarity, trust and rapid intervention. Dense fleet data should feel structured rather than noisy. Driver actions must be readable in daylight and usable with one hand. Customer tracking should expose only the relevant job and its approved status/evidence.

> The demo may use synthetic jobs and simulated GPS, but any such state must be clearly marked. Never present fixture savings as a measured customer outcome, or a stale GPS position as live.

The second paragraph is the honesty rule already documented in [01.4](../01-vision-and-principles.md), [09.7](../09-realtime-tracking.md), and [10.4](../10-optimization-integration.md) - now stated as design intent.

## 2. Visual tokens

### Dispatcher theme (dark)

| Token | Value | Usage |
|-------|-------|-------|
| `dispatch/bg` | `#0F172A` | Main workspace |
| `dispatch/surface` | `#1E293B` | Cards and panels |
| `dispatch/surface-raised` | `#263449` | Raised controls, selected surfaces |
| `dispatch/border` | `#334155` | Separators and borders |
| `text/primary` | `#F8FAFC` | Primary text |
| `text/secondary` | `#94A3B8` | Secondary labels |
| `brand/primary` | `#4F8CFF` | Primary action, active route |
| `status/success` | `#10B981` | On-time / healthy |
| `status/warning` | `#F59E0B` | At-risk |
| `status/danger` | `#EF4444` | Late / critical |

Matches the extraction ([design-extract.md Section 2](design-extract.md)) exactly.

### Driver theme

Handoff: background `#F8FAFC`, surface `#FFFFFF`, primary text `#0F172A` (light). **The Figma driver frames are dark (`#080D16`)** - see [Section 11](ui-ux-handoff.md) and [Section 12](ui-ux-handoff.md); this is an open question, resolved before driver screens are built. Rules regardless of resolution:

- Body/supporting text legible on bright screens; primary actions use a high-contrast blue or green with explicit action labels.
- Critical controls >= **48 x 48 px** touch target; primary mobile actions ~**52-56 px** high.

### Customer portal

Light background `#F4F7FB`; base brand primary `#2563EB` (tenant override resolves at runtime - [Section 6](#6-white-label-theming)). Contrast re-tested after tenant colors are applied.

### Typography & spacing

- Typeface **Inter**. 32/28 px major desktop headings; 20-23 px screen headings; 14-15 px body; 10-12 px supporting labels.
- Spacing scale: 4, 8, 12, 16, 24, 32 px. Radius scale: 8, 12, 16, 24 px.
- Explicit rule: 10 px labels are **not** permitted for essential instructions - critical information is raised to a readable size in code.

## 3. Dispatcher screen contracts (condensed, normative)

- **Live Operations** - KPIs (active vehicles, in-progress jobs, unassigned jobs, at-risk stops); map as main canvas with driver initials/status/freshness markers; unassigned-job tray with drag-assign on desktop/tablet; vehicle drawer (driver/vehicle, current job, next stop, ETA, last-fix time, alerts); stale vehicles render grey/ghost with a plain-language *"Last updated ... ago"* label - never implied live.
- **Dispatch Board** - horizontal timeline per shift with fixed left column of driver/vehicle labels; job blocks label status/urgency with text, not colour alone; during drag only valid lanes highlight; ETA impact + constraint warnings shown **before** commit; commit through one authoritative command; on conflict restore server state and explain what changed; horizontal scrolling usable on tablet and keyboard; a **non-drag assignment action** exists for accessibility and touch fallback.
- **Route Optimisation** - side-by-side baseline vs proposal with same stops/scale/units; shows duration, distance, stop order, arrival estimates, affected windows, unsupported/infeasible jobs; simulated fixture data clearly labelled in demo mode; no fake computation - a short display dwell is allowed only if the UI does not claim the solver is still calculating; solver output is a proposal - dispatcher approval required before publishing a route version.
- **Exceptions & Alerts** - triage list left, detail drawer right; **no interruptive modals for ordinary triage**; each alert carries severity, entity, location/context, freshness, and a recommended next action where supported; acknowledge/reassign/resolve append auditable events; geofence status suppresses GPS boundary jitter and shows uncertainty.
- **Customer Tracking & Proof Hub** - admin settings for brand, notification rules, proof requirements, link expiry/revocation; **phone preview of the exact customer-facing experience**; tokens are single-job, expiring, revocable; no fleet-wide locations, internal notes, or driver personal information on public URLs; proof media stays on protected object storage, shown only to authorized recipients after policy checks.

## 4. Driver screen contracts (condensed, normative)

- **Today & Route Queue** - next stop dominant (address, service type, due time, navigation action); upcoming stops in sequence; network/sync state visible; Start Shift enables location sharing only under the operator's explicit on-duty policy; external navigation is acceptable and the UI never implies native turn-by-turn when it hands off.
- **Active Job** - destination, task instructions, scheduled time in one scan; accessible slide/confirm with clear label and alternative tap/keyboard path; arrival recorded through the authenticated API, preserving device-captured time/GPS metadata where justified; call-dispatch and external-navigation always visible.
- **Proof of Service & Exceptions** - signature/photo/recipient fields conditional on service configuration; skip/exception visually distinct from the primary completion action; evidence uploads protected (DB stores object key/metadata, never a public permanent URL); offline commands are **pending, not completed**, until server acceptance - conflict/retry states shown explicitly.

## 5. Shared state & interaction contract

One domain state for jobs, stops, drivers, vehicles, routes, route stops, positions, and exceptions across all screens ([08](../08-domain-model-and-events.md)). The server remains authoritative; socket delivery is not durable storage; on reconnect the client fetches an authorized snapshot, then resumes events ([09.7](../09-realtime-tracking.md)).

### Client event contracts - mapping to the canonical catalog

The handoff suggests client-facing event names. They map onto our canonical catalog ([08.4](../08-domain-model-and-events.md)); the catalog wins, and the client layer may alias:

| Handoff name | Canonical event | Notes |
|--------------|-----------------|-------|
| `vehicle.position_updated` | `vehicle.position` (telemetry, direct socket) | non-durable, snapshot recovery |
| `job.status_changed` | `job.assigned` / `job.started` / `job.completed` / `job.cancelled` / `job.failed` | alias to the specific transition events |
| `route.draft_created` | route lifecycle: `route.published` etc. | draft creation is a query-side concern; published plans emit `route.published` |
| `route.published` | `route.published` (identical) | also `route.superseded` on re-publication |
| `dispatch.exception_created` | `alert.raised` | payload carries severity, type, related aggregate |
| `proof.upload_status_changed` | `pod.captured` | plus object-storage upload state tracked client-side |

Every durable event carries `eventId`, `schemaVersion`, and relevant entity version. Consumers dedupe on `eventId`.

### ETA cascade (the five-step rule)

1. Display a **preview** state, not yet committed.
2. Request a server/solver ETA estimate for affected downstream stops.
3. Visually indicate changed ETAs, movement, and newly at-risk windows.
4. Dispatcher confirms or cancels.
5. On confirmation: persist assignment/route version + audit event, then broadcast committed state.

No frontend-only arithmetic approximation presented as a verified road ETA - demo mode uses deterministic projections and labels the mode ([05.5](../05-web-app-architecture.md), [10.4](../10-optimization-integration.md)).

### Motion

Smooth marker interpolation between accepted positions only - never through impossible paths, never making a stale pin look live; short transitions for drawers/status; `prefers-reduced-motion` respected; loading states report real activity (no artificial delays).

## 6. White-label theming

Tenant theme object contains approved design tokens - **not arbitrary CSS** (same decision as [01.3b](../01-vision-and-principles.md) and the threat model in [11.1](../11-security-and-compliance.md)):

```ts
type TenantTheme = {
  displayName: string;
  logoAssetKey?: string;
  primary: string;
  primaryContrast: string;
  success?: string;
  warning?: string;
  danger?: string;
  customDomain?: string;
};
```

- Validate custom domain ownership before activation; resolve only configured/verified hostnames; never trust `Host` as authentication ([11.5](../11-security-and-compliance.md)).
- Contrast and focus states tested per tenant theme; status colours stay semantically stable - branding must not make critical status unreadable.

## 7. Responsive behaviour

- **Desktop command center:** full sidebar, map, detail drawer, multi-column KPI strip.
- **Tablet:** collapsible sidebar, stackable detail drawer; primary map/dispatch interactions usable by touch.
- **Driver:** mobile-first, one primary action per view, no dense data tables.
- **Customer portal:** stacked layout on narrow screens; map and status usable without horizontal page scrolling.

Matches the tiers in [05.1b](../05-web-app-architecture.md); the handoff adds the portal stacked-layout rule.

## 8. Accessibility & error states

- Status never conveyed by colour alone (pair with text/icon); visible keyboard focus; accessible labels; keyboard alternative to drag/drop; semantic buttons; sufficient contrast.
- `prefers-reduced-motion`.
- Every async flow has loading, success, empty, offline/stale, permission-denied, validation-error, and server-error states.
- Internal errors translate into actionable user messages (`uiMessage`-style presentation - [ADR-0011](../adr/0011-empathetic-error-handling.md)); never stack traces or sensitive identifiers.
- Job status and upload outcomes announced to assistive technology without repeated interruptions.

## 9. React implementation handoff

The handoff's suggested structure (below) is mapped onto our monorepo layout ([03](../03-monorepo-layout.md)) - our established structure wins, with the handoff's components mapped in:

| Handoff suggestion | Our structure (authoritative) |
|--------------------|-------------------------------|
| `apps/dispatcher/src/app/` | `apps/web/src/app/` (router, providers, theme) |
| `apps/dispatcher/src/screens/` | `apps/web/src/app/routes/` (thin route pages) |
| `apps/dispatcher/src/components/` (`StatusChip`, `KpiCard`, `DriverPin`, `Drawer`, `Timeline`, `JobCard`, `ETAChange`) | `apps/web/src/shared/ui/` (design-system primitives) + feature-local components |
| `apps/dispatcher/src/features/{dispatch,tracking,routes,exceptions,branding}/` | `apps/web/src/features/{live-map,dispatch-board,optimization,alerts,customer-tracking,roster}/` |
| `apps/dispatcher/src/adapters/demo/` + `adapters/api/` | **No client demo adapter.** Per [ADR-0007](../adr/0007-demo-strategy.md), the demo seam is server-side (`DEMO_MODE` API with in-memory repos + simulator). The web app has one adapter: the API client ([05.9](../05-web-app-architecture.md)). The handoff's "demo adapter" maps to *the same API client pointed at a `DEMO_MODE` server*. |
| `apps/dispatcher/src/contracts/` | `packages/contracts` (single source of truth - [ADR-0003](../adr/0003-contracts-first.md)) |

Presentation components never call API routes directly ([05.4](../05-web-app-architecture.md)); the map uses a source/layer update pattern so vehicle features change without re-rendering the screen; live positions live in a dedicated store/query cache that updates individual markers and selectors.

### Recommended implementation sequence -> phase mapping

| Handoff step | Where it lands |
|--------------|----------------|
| 1. Tokens, semantic primitives, shell | Phase 1 |
| 2. Shared demo state + repeatable seed/reset | Phase 1 (`DEMO_MODE` API + scenario reset) |
| 3. Live Operations + assignment preview | Phase 1 |
| 4. Timeline + ETA cascade demo | Phase 1 |
| 5. Optimisation, exceptions, portal screens | Phase 1 |
| 6. Driver mobile flows | Phase 1 (Expo web on the demo tablet) |
| 7. Replace demo adapter with API adapter | Phase 2 (already the same client - the server swaps memory->Postgres) |
| 8. Real socket events, freshness, recovery | Phase 4 |

Steps 7-8 are deliberately beyond Phase 1 ([14](../14-roadmap-and-gates.md)).

## 10. Acceptance checklist (normative for Phase 1 exit)

Each item maps to an existing test or budget; the checklist becomes the Phase 1 exit review alongside the E2E suite ([12.2](../12-testing-and-quality.md)):

- [ ] All 5 dispatcher + 3 driver screens: consistent layout, typography, states -> screenshots review at desktop/tablet/mobile before release
- [ ] Demo reset returns to the same seeded scenario -> E2E (Morning Rush / Emergency / Proof of Service)
- [ ] Drag/drop has keyboard/touch alternative + pre-commit validation feedback -> [05.5](../05-web-app-architecture.md) + E2E
- [ ] Route savings solver-derived or visibly labelled simulated -> [10.4](../10-optimization-integration.md) + E2E assertion
- [ ] GPS freshness and stale/offline visible on all relevant screens -> [09.7](../09-realtime-tracking.md)
- [ ] Driver actions distinguish queued from server-confirmed -> [06.4](../06-driver-app-architecture.md) + hardening test #5
- [ ] Public tracking restricted to one job, expiry/revocation -> [11.4](../11-security-and-compliance.md) + hardening test #7
- [ ] Tenant theme changes don't break contrast or hierarchy -> theme contrast check (per-theme), Phase 6 hardening
- [ ] Every async screen has loading/error/empty/offline variants -> component review checklist
- [ ] Mobile primary touch targets >= 48 x 48 px, key actions labelled -> [06.1b](../06-driver-app-architecture.md)
- [ ] Reduced-motion and keyboard support -> [05.1b](../05-web-app-architecture.md)

## 11. Reconciliation & deltas

1. **Driver theme conflict.** Handoff text (Section 2 driver theme) specifies a **light** driver theme (`#F8FAFC`/`#FFFFFF`); the Figma driver frames I extracted are **dark** (`#080D16`). The design intent ("readable in daylight") argues light. -> [Section 12](#12-open-questions-for-sign-off) Q1.
2. **Portal primary.** Handoff gives `#2563EB` as base portal primary; dispatcher brand primary is `#4F8CFF`. Resolved: portal resolves the tenant theme at runtime with `#2563EB` fallback; dispatcher stays `#4F8CFF`. No conflict.
3. **Typography ranges.** Handoff (32/28, 20-23, 14-15, 10-12) is a range; the Figma frames use 32/22/15. Resolved: 32/22/15 is the core scale; 28/20-23 are secondary options; 10-12 px only for non-essential labels.
4. **React structure.** Handoff's `apps/dispatcher` naming/structure maps to our `apps/web` features-first layout (Section 9 table). Our monorepo remains authoritative; nothing structural changes.
5. **Client demo adapter.** Handoff suggests `adapters/demo` in the client; ADR-0007 already places the demo seam server-side. Resolved per Section 9 - one API client, demo is a server mode. No client-side demo data exists, keeping demo and production UIs identical.
6. **Event names.** Handoff names are aliased onto the canonical catalog (Section 5 table). No catalog changes.
7. **Deliberate correction acknowledged:** the handoff's "example route savings labelled simulated" rule matches our existing honesty rules - the correction is already the documented default, now also stated as design intent (Section 1).

## 12. Open questions for sign-off

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | **Driver theme:** handoff says light (`#F8FAFC`); Figma frames are dark (`#080D16`). Which is authoritative? | **RESOLVED 2026-10-27 - light wins.** Design intent ("readable in daylight, one-handed") is the law; a dark driver app in direct sunlight is a safety hazard. The three Figma frames are updated before any driver-screen code. |
| Q2 | **Portal fallback primary `#2563EB`** vs. tenant-resolved branding - confirm the fallback stands when a tenant has no override? | **RESOLVED 2026-10-27 - yes.** `#2563EB` fallback; tenant theme wins when configured. |
| Q3 | **Begin Phase 1 demo build now** against this handoff (frontend + DEMO_MODE API), per your recommendation? | **RESOLVED 2026-10-27 - gated by Phase 0.** Build starts only after a named design partner says yes to the 120-second Figma pitch; the package is approved and frozen in the meantime ([open-decisions](../open-decisions.md) approval record). |

### Figma frame update checklist (Q1, executed by the file owner in Figma)

The REST API is read-only - frame edits are manual in the Figma UI. For the three driver frames (`5:4`, `5:49`, `5:91`):

1. Background `#080D16` -> `#F8FAFC`; panel/card fills -> `#FFFFFF`.
2. Primary text `#F8FAFC` -> `#0F172A`; secondary text -> slate-700-family on light (`#334155`/`#475569`).
3. Keep: slide-to-confirm slider, 48 x 48 px touch targets, 52-56 px primary buttons, status colors (success/warning/danger stay semantic).
4. Re-check contrast after the flip (portal-level rule from Section 6 applies to driver screens too).

Until the frames are updated, the handoff text (Section 2 driver theme) is authoritative for implementation, not the stale frame pixels.





