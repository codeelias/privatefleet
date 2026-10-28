# 05 - Web App Architecture (Dispatcher Dashboard)

**Status:** Draft v1 - for approval.
**Decisions:** [ADR-0006](adr/0006-react-stack.md), [ADR-0010](adr/0010-map-tiles.md).
**Related:** [08](08-domain-model-and-events.md) (domain), [09](09-realtime-tracking.md) (realtime), [14](14-roadmap-and-gates.md) (demo scope).

## 5.1 Stack

React + TypeScript (strict) + Vite  /  TanStack Router (type-safe routing) + TanStack Query (server state)  /  Zustand (UI state)  /  react-hook-form + zodResolver (forms, contract schemas)  /  dnd-kit (drag-and-drop)  /  MapLibre GL JS  /  Tailwind CSS + a small vendored shadcn-style component set  /  pino-less client logging (console + error reporting later).

## 5.1b UI/UX design language - the Calm Command Center

The demo must feel premium, high-tech, and calm - never overwhelming. Visual and interaction rules:

- **Dark-mode premium aesthetic.** High-contrast dark theme for the dispatcher (per `../screenshot/dashboard.jpg`): reduces eye strain on 12-hour shifts and makes status colors pop (green = on track, amber = at risk, red = on fire). Color is information, never decoration.
- **The "Smart Gap" impact modal.** Dropping a job is never a silent mutation: the system flashes a human-readable consequence first - *"Assigning this to Sarah adds 12 min to her next stop. Confirm?"* - with any constraint violations listed. The confirm step is where the "I am in control" feeling is manufactured ([5.5](#55-drag-and-drop-the-honey-pot-interaction)).
- **Empathetic micro-copy.** No robotic errors. *Bad:* `409 Conflict: JOB_VERSION_MISMATCH`. *Good:* "Wait - Sarah just updated this job on her phone. Reload to see her latest progress." Every user-facing error renders the API's `uiMessage` field, never raw error text ([04.4](04-backend-architecture.md), [ADR-0011](adr/0011-empathetic-error-handling.md)).
- **Ambient awareness.** The map breathes: moving vehicles pulse softly; disconnected vehicles fade to a grey "ghost" state with a stale-age label - the dispatcher sees who is out of range without reading a log ([09.7](09-realtime-tracking.md)).
- **Motion discipline.** Micro-interactions (drag lift, drop settle, pulse, drawer glide) run at 60 fps and are interruptible; nothing animates for its own sake. Motion communicates state change; it never delays the result. `prefers-reduced-motion` is respected - motion degrades to instant state changes for users who opt out.

**Responsive tiers - one dashboard, three postures:**

| Posture | Width | Behaviour |
|---------|-------|-----------|
| Command center | >= 1440 px | Full-bleed map + left roster rail + right telemetry drawer + bottom job queue |
| Laptop | 1024-1439 px | Rails collapse into togglable panels; map stays dominant |
| Demo tablet | 768-1023 px | Single-pane with bottom-sheet queue; drag-and-drop fully functional by touch |
| Narrow (< 768 px) | - | Not a dispatcher surface; driver flows belong to the driver app ([06](06-driver-app-architecture.md)) |

The demo is rehearsed on the tablet tier, so touch targets (>= 44 px), touch drag-and-drop, and keyboard equivalents ([5.5](#55-drag-and-drop-the-honey-pot-interaction)) are first-class, not afterthoughts. Budgets live in [5.8](#58-performance-budgets-demo-critical).

## 5.2 Structure (feature-based)

```
apps/web/src/
+- app/
|  +- router.tsx              # TanStack Router setup, route tree, auth guard
|  +- providers.tsx           # QueryClient, socket client, theme, tenant branding
|  +- routes/                 # route-level pages (thin; delegate to features)
|  +- errors.tsx              # error boundary, 404/403 pages
+- features/
|  +- live-map/               # Screen 1: map canvas, vehicle pins, routes,
|  |                          # job markers, drop targets, KPI strip
|  +- dispatch-board/         # Screen 2: Gantt lanes, drag-drop, impact preview
|  +- optimization/           # Screen 3: baseline vs proposed, approve flow
|  +- alerts/                 # Screen 4: exception feed, geofence board
|  +- customer-tracking/      # Screen 5: branded page preview, POD vault
|  +- roster/                 # driver/vehicle management (supporting screen)
|  +- demo/                   # demo-only: scenario reset, 120s guide panel
+- shared/
|  +- api/                    # typed client generated from contracts (thin fetch)
|  +- realtime/               # socket client, subscription hooks, recovery
|  +- ui/                     # design-system primitives (Button, Drawer, Chip,
|  |                          # Badge, Table, Dialog, SlideToConfirm, KPI...)
|  +- lib/                    # date/number formatting (tenant timezone), hooks
|  +- config/                 # VITE_* env parsing (zod), tile/style config
```

**Rule:** features own their domain UI and may not import each other; shared code goes to `shared/`. Cross-feature coordination happens through server state (Query cache) and socket events, not through component coupling.

## 5.3 The five screens -> features

| Screen (sales blueprint) | Feature | Reference image |
|--------------------------|---------|-----------------|
| 1. Live Command Center ("God View") | `live-map` | `screenshot/dashboard.jpg` |
| 2. Dispatch Timeline & Assignment Board | `dispatch-board` | `screenshot/Dispatch Board.jpg` |
| 3. Route Optimization Workbench | `optimization` | `screenshot/Route Optimisation.jpg` |
| 4. Exception & Alert Console | `alerts` | `screenshot/Exceptions and Performance.jpg` |
| 5. Customer Tracking & Proof Hub | `customer-tracking` | `screenshot/Jobs and Work Orders.jpg` + POD/signature refs |

Driver-facing screens live in the driver app ([06](06-driver-app-architecture.md)), not here. Screen frames, dimensions (1440 x 940), tokens, and micro-copy come from the Figma master design ([design-extract](figma/design-extract.md)); the design's workspace nav also includes a supporting **Jobs & Work Orders** list/detail screen - implemented alongside the roster screen, not part of the core five demo screens.

## 5.3b Screen 5 detail - the premium customer portal

The dispatcher screens sell operational control; the **Customer Tracking & Proof Hub** is the revenue closer ([01.3b](01-vision-and-principles.md)). Requirements for the public page and its preview:

- **Design:** light-mode, mobile-first, branded with the tenant's tokens - the deliberate opposite of the dispatcher's dark command center. Loads in under 1.5 s on a mid-range phone on 4G ([5.8](#58-performance-budgets-demo-critical)).
- **The "pizza tracker" effect:** not a dot on a map - a status timeline ("Driver assigned -> En route -> Arrived at pickup -> In transit -> Delivered"), every step driven by the same job events the dispatcher sees ([08.4](08-domain-model-and-events.md)).
- **Trust & compliance (opt-in identity):** driver name, photo, and vehicle description are shown only when the tenant explicitly enables them for the vertical (e.g., medical transport passenger reassurance); they are the only identity fields the public endpoint may ever expose ([11.4](11-security-and-compliance.md)). Displaying staff identity is subject to the worker-monitoring and data-protection gates ([11.6](11-security-and-compliance.md)).
- **POD vault:** the timeline shows POD completion status; the signature/photo itself opens only through the separately authorized vault - a tracking token never grants media access ([11.4](11-security-and-compliance.md)).
- **The "wow" factor:** the dispatcher dashboard carries a **"Preview as Customer"** button that opens the branded page in a new tab (or embedded preview) with a demo tracking token - the prospect sees exactly what *their* clients will see, mid-demo ([14.2b](14-roadmap-and-gates.md) act 5).
- **White-label notifications:** customer email/SMS dispatch templates carry the tenant's branding and tone; the dispatcher previews the exact message the client will receive and controls cadence - previewed in Phase 1, live in Phase 6 ([01.3b](01-vision-and-principles.md)).

## 5.4 State management strategy

- **Server state (TanStack Query):** jobs, stops, routes, drivers, vehicles, alerts, snapshots. Mutations are explicit commands with `Idempotency-Key`; on 409 the UI shows the conflict and offers reload (never silently overwrites).
- **Live updates:** the socket client writes into the Query cache (`setQueryData`) for position/status events and invalidates affected queries on business events. The cache is the single projection the UI renders from.
- **Optimistic UI:** allowed only for reversible presentation (e.g., drag ghost while awaiting impact preview). Final state always comes from the server response/event.
- **UI state (Zustand):** drawers open/closed, selected entities, draft assignment (source/target), demo guide step. The MapLibre instance lives in a ref/module singleton, never in React state.
- **Forms:** react-hook-form + zodResolver against contract schemas; server errors mapped to field errors.

## 5.5 Drag-and-drop (the Honey Pot interaction)

- dnd-kit for: job card -> driver pin (map) and job block -> driver lane (timeline).
- Every drag interaction has a **keyboard equivalent** (focus -> Enter to pick up -> arrows to choose target -> Enter to drop) - an accessibility requirement, not a nicety.
- Flow: drop -> `POST /v1/jobs/{jobId}/assignment-preview` (dry-run; returns ETA deltas and constraint violations) -> "Smart Gap" impact flash ("+12 min to next stop" or violation warning) -> explicit **Confirm** commit -> `POST .../assign` with idempotency key -> server events repaint map, timeline, ETA panel.
- Assignment and reassignment always go through the **same command** as the timeline screen - one source of truth for assignment rules.

## 5.6 Map layer

- One MapLibre GL instance owned by `features/live-map`; other features request overlays through a small typed API (show route, highlight stop) rather than owning their own maps.
- Layers: vehicle pins (status-colored), route polylines (planned vs active vs completed), job markers, geofence polygons.
- Position updates arrive via socket at <=1 Hz per vehicle (coalesced); markers animate between points; no full re-renders.
- Tile/style config comes from `shared/config` (OpenFreeMap style + fallback per [ADR-0010](adr/0010-map-tiles.md)).

## 5.7 White-label theming

- Design tokens as CSS variables: colors, radius, fonts, logo URL, brand name - applied at boot from the authenticated tenant's `branding` JSON.
- Dispatcher UI default: dark "operations centre" theme (per reference image). Customer-facing preview renders the light branded theme.
- The same token mechanism will drive the public tracking page in Phase 6.

## 5.8 Performance budgets (demo-critical)

| Budget | Target | Enforced by |
|--------|--------|-------------|
| Assignment drop -> committed visual update | < 500 ms on demo hardware | Playwright timing assertion (CI) |
| Initial dashboard load | < 3 s on demo tablet (4G) | Playwright + manual demo rehearsal |
| JS bundle (initial route) | < 350 kB gzip | Build-size check in CI |
| Map frame updates | coalesced <=1 Hz/vehicle | Socket client logic + code review |
| Primary interaction feedback (press/lift/hover) | < 100 ms perceived | No blocking work in handlers + demo rehearsal |
| Tablet tier (768-1023 px) usability | all core flows operable by touch | Playwright at tablet viewport (E2E uses a tablet profile) |
| Customer tracking page load (public) | < 1.5 s on a mid-range phone, 4G | Playwright (mobile profile, throttled) + bundle budget |

## 5.9 Demo mode in the web app

- `features/demo`: scenario reset button (calls `/v1/demo/scenarios/{id}/reset`), the 120-second guide panel, and a "simulated data" badge whenever the API reports `DEMO_MODE`.
- The web app itself has **no** demo data; all simulation lives server-side ([ADR-0007](adr/0007-demo-strategy.md)). This keeps the UI identical between demo and production.




