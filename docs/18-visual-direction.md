# PrivateFleet map-first dispatcher design standard

## Principle

The map is the operator's primary workspace. Chrome, metrics and supporting
information consume only the space they need; panels float over the map and
never reserve a column or footer that shrinks it.

The identity is warm and restrained: ivory application chrome, a charcoal map,
orange route emphasis, paper surfaces, hairline borders and quiet shadows.
Elegance comes from spacing, alignment, type hierarchy and legibility — not from
stacking rounded widgets or reducing geographic detail.

## Header

A single compact toolbar, not a capsule of controls:

- Brand mark and wordmark on the left, with quiet `Fleet operations · tenant`
  context beneath.
- Text navigation in one alignment system. Active workspace has an orange
  underline; inactive items have no container or background.
- Connection state, date and account action aligned right.
- Mobile navigation is a horizontally scrollable second row with the same
  underline treatment.

## Fleet overview

A **status rail**, not four compressed cards:

- 44 px collapsed row with a chevron, four values and labels, separated by
  hairline dividers.
- Chevron expands the detailed KPI cards below; the preference is stored locally.
- Collapsing restores map height. The map container resizes through its existing
  `ResizeObserver`; it is never remounted.

## Map

- Fills all remaining height (`flex: 1; min-height: 0`); no permanent sidebar
  or footer.
- Dark charcoal OSM basemap is the default visual identity, with a **light map**
  toggle for maximum label and road legibility. The light mode removes the
  tonal filter.
- Selected route: orange. When a driver is selected, other routes recede to a
  restrained cool grey-blue. Orange stroke carries a light casing.
- Vehicle pins carry text status on hover/title; GPS-stale pins are ghosted and
  labelled with last-known/age.
- Map controls sit at the edges and use familiar SVG icons.
- **Raster limitation:** OSM labels are baked into the tiles, so a selective
  per-label text halo is not technically available without a vector style or a
  dark tile provider with baked halos. The light map is the accessibility
  fallback; the dark filter is lifted rather than crushed.

## Vehicle panel

A floating card with explicit text actions, not an unexplained icon set.

- **Default compact:** driver, registration, GPS freshness, current job/next
  significant stop, compact exception summary and `Details`.
- **Expanded:** identity, GPS freshness with age, route stop timeline, current
  job and compact exception area.
- Header actions: `Expand` / `Minimise` and `Close`; 28 px targets with visible
  focus.
- Closed: a `Selected vehicle` launcher reopens in compact mode.
- The panel overlays the map; none of these states resize or refetch the map.

## Unassigned jobs

- Starts as a **40 px collapsed bar** with label and count.
- Expands into an overlay drawer; the map dimensions do not change.
- Cards show pick-up/drop-off text, priority and stop count. Click-to-assign is
  available without drag; drag remains a shortcut.
- Collapsing preserves queue state.
- PostgreSQL/pilot mode never shows demo-only reset instructions.

## Colour and accessibility

WCAG 2.2 AA is the baseline.

| Token | Value | Use |
|---|---|---|
| `command-bg` | `#F7F4EC` | warm application shell |
| `command-surface` | `#FFFFFF` | cards and panels |
| `command-raised` | `#EEE9DE` | quiet grouping |
| `command-border` | `#D4CDBF` | decorative hairlines |
| `control-border` | `#827F77` | meaningful control boundaries |
| `text-primary` | `#17212B` | primary text |
| `text-secondary` | `#596574` | supporting text |
| `brand-primary` | `#F28C28` | brand, routes, active underline |
| `brand-ink` | `#9A3E00` | orange-family text on light surfaces |
| `on-brand` | `#17212B` | text/icons on solid orange |
| `focus` | `#155EEF` | visible keyboard focus |
| `status-success` | `#18794E` | global live / complete |
| `status-warning` | `#8A4B08` | attention / GPS stale |
| `status-danger` | `#B42318` | urgent |

- No colour-only meaning: pick-up/drop-off, priority, stale and live states
  carry text labels.
- Global connection and per-vehicle GPS freshness are separate. **Global live**
  is the WebSocket state; **GPS stale (last known, updated Xm ago)** is telemetry.
- Body text generally 12–16 px; supporting labels are not set in wide uppercase
  tracking by default.
- Visible focus rings, 24 px minimum targets, 28 px panel controls.
- Light map is an accessibility option, not a decorative theme.

## Performance

- Opening, closing, minimising or resizing a panel does not fetch fleet state or
  route geometry.
- Expanding/collapsing the overview only changes layout; the map container's
  `ResizeObserver` invalidates size.
- The map instance stays mounted across all ordinary interaction states.
- Verified: **one `/v1/fleet/routes` request** across panel, drawer, overview and
  map-style toggles; **map height unchanged** when the drawer opens.
- No new polling, services or routing-limit changes.

## Implementation

- `apps/web/src/app/App.tsx` — toolbar, status rail, panel states, drawer.
- `apps/web/src/features/live-map/MapCanvas.tsx` — map style, casing, GPS labels.
- `apps/web/src/features/dispatch/JobCard.tsx` — parcel card.
- `apps/web/src/index.css` — tokens, map treatment, focus.
- `apps/web/src/shared/ui/*` — KPI, panel, status primitives.

The LAN deployment also forwards `/socket.io/*` through Caddy to the API so the
global connection state reflects the real socket rather than a static badge.

## Evidence

- `refined-max.png` — map maximised; panel closed; queue collapsed.
- `refined-expanded.png` — vehicle panel and unassigned drawer overlaying the map.
- `refined-light.png` — light map mode.
- `refined-expanded.png` uses a client-side visual fixture for queue cards to
  demonstrate layout; the deployed count was verified separately against the
  fleet API (0 unassigned at capture time).
