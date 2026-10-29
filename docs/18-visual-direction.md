# PrivateFleet map-first dispatcher design standard

## Principle

The map is the operator's primary workspace. Chrome, metrics and supporting
information consume only the space they need; panels float over the map and
never reserve a column or footer that shrinks it.

The identity stays warm and restrained: ivory application chrome, a charcoal
map as the default visual style, orange route emphasis, paper-like cards and
quiet borders. Elegance comes from spacing, hierarchy and legibility, not from
dimming geographic detail.

## Map-first layout

- Persistent top navigation: brand, workspace context, pill navigation,
  connection status and account actions. Target 56–64 px high.
- Fleet overview: a **44 px compact bar** by default. The chevron expands the
  four detailed KPI cards in place; the preference is stored locally.
- Map: `flex: 1; min-height: 0`; fills all remaining height. No permanent
  sidebar or footer column. Internal `ResizeObserver` calls
  `invalidateSize()` only when the container actually changes.
- Selected vehicle: a floating card over the map with explicit minimise,
  close and reopen controls. Compact mode keeps identity and status.
- Unassigned jobs: a **40 px collapsed drawer** showing the queue label and
  count. Expanding overlays the map; it never resizes or remounts it.
- Both panels use CSS position/transform/opacity; no route fetch, socket
  reconnect or map re-initialisation is tied to panel state.

## Panel states

| State | Behaviour |
|---|---|
| Expanded | Identity, GPS freshness, job reference, stop timeline, attention |
| Compact | Driver/vehicle identity, status, explicit expand action |
| Closed | Removed from map; a `Selected vehicle` launcher reopens it |
| Queue collapsed | 40 px bar with label and count |
| Queue expanded | Overlay drawer with horizontal parcel cards; map dimensions unchanged |

## Colour and accessibility

WCAG 2.2 AA is the baseline.

| Token | Value | Use |
|---|---|---|
| `command-bg` | `#F7F4EC` | warm application shell |
| `command-surface` | `#FFFFFF` | cards and floating panels |
| `command-raised` | `#EEE9DE` | quiet grouping |
| `command-border` | `#D4CDBF` | decorative hairlines |
| `control-border` | `#827F77` | meaningful input/control boundaries |
| `text-primary` | `#17212B` | primary text |
| `text-secondary` | `#596574` | supporting text |
| `brand-primary` | `#F28C28` | brand mark, routes, selected emphasis |
| `brand-ink` | `#9A3E00` | orange-family text on light surfaces |
| `on-brand` | `#17212B` | text/icons on solid orange |
| `focus` | `#155EEF` | visible keyboard focus |
| `status-success` | `#18794E` | global live / complete |
| `status-warning` | `#8A4B08` | attention / GPS stale |
| `status-danger` | `#B42318` | urgent |

Additional rules:

- No colour-only meaning: pick-up/drop-off, priority, stale and live states
  carry text labels or icons.
- Global connection and vehicle GPS freshness are separate concepts:
  **Global live** is the socket state; **GPS stale (last known, updated Xm
  ago)** is the vehicle's telemetry state.
- Normal text meets 4.5:1 and large text 3:1 against its rendered surface.
- Interactive controls have visible focus and at least 24 × 24 px targets;
  panel controls are 32 px.
- The map has a light/dark toggle. The dark style is a lifted charcoal
  inversion of the same OSM tiles; the light style removes the filter for
  maximum label legibility. Route lines use an orange stroke with a light
  casing to separate them from the map. Raster OSM labels are baked into the
  tiles, so per-label halos are not available without a vector style; the
  light mode is the accessibility fallback.

## Data truth

- Active vehicles: vehicles not `inactive` or `maintenance`.
- Jobs in progress: all jobs not `unassigned`.
- Unassigned: jobs whose authoritative status is `unassigned`.
- Counts in the compact bar, drawer badge and cards come from the same
  `unassigned` array.
- Demo-only scenario controls and reset language are hidden outside demo mode.
- GPS-stale pins are ghosted and labelled; a global live socket does not imply
  fresh GPS.

## Implementation

- `apps/web/src/app/App.tsx` — shell, compact overview, panel states, drawer.
- `apps/web/src/features/live-map/MapCanvas.tsx` — map style toggle, casing,
  GPS labels, resize observer.
- `apps/web/src/features/dispatch/JobCard.tsx` — parcel card.
- `apps/web/src/index.css` — tokens, map filters, focus.
- `apps/web/src/shared/ui/*` — KPI, panel, status primitives.

## Performance guardrail

Open/close/minimise/resize actions must not fetch fleet state or route
geometry. The verification run measured **one `/v1/fleet/routes` request
across all panel, drawer, overview and map-style toggles**. Opening the drawer
left the map at the same height; expanding the overview changed it and let the
existing `ResizeObserver` resize the map.

## Evidence

- `mapfirst-max-cards.png` — map maximised, panels collapsed.
- `mapfirst-expanded-cards.png` — vehicle panel and unassigned drawer overlaying
  the map. Queue cards in that capture use a visual fixture; production counts
  are read from the API.
- Dispatcher, map-quality, auth and demo suites remain the functional gates.
