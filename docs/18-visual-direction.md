# PrivateFleet visual direction

## Intent

The reference set points to a **warm field-tool aesthetic** rather than a dark
developer console: an ivory workspace, a charcoal instrument-panel map, orange
route emphasis, and paper-like cards that float over operational data. The
reference is inspiration only; PrivateFleet does not copy FastTrack branding,
copy, or assets.

## Tokens

| Token | Value | Use |
|---|---|---|
| `command-bg` | `#F2EEE4` | workspace canvas |
| `command-surface` | `#FBF8F1` | cards, header, floating panels |
| `command-raised` | `#E9E1D2` | chips, hover, inset rows |
| `command-border` | `#D8CFBD` | hairline borders |
| `text-primary` | `#191815` | headings and primary data |
| `text-secondary` | `#756E61` | labels and metadata |
| `brand-primary` | `#EF842F` | routes, selection, primary actions |
| `status-success` | `#3E7A5B` | live / complete |
| `status-warning` | `#B98525` | attention |
| `status-danger` | `#B84C38` | urgent / stale |

- Typeface: Inter, with tight tracking on display text and uppercase,
  letter-spaced micro-labels.
- Radii: 16-22 px for cards, 26 px for the map shell, full pills for nav/chips.
- Shadows: soft, warm-neutral, low opacity; no neon or heavy glass.
- Map: OSM raster tonally inverted to a charcoal map, preserving the offline
  tile source. Routes use `#EF842F`; a selected route uses `#FFD2A8` at 5 px.

## Composition

- **Shell:** cream top bar, route-mark logo, pill workspace nav, live status,
  avatar/sign-out. The old left sidebar is removed; navigation is horizontal
  and scrolls on smaller screens.
- **Live Operations:** compact KPI rail above a full-width dark map. The
  selected-vehicle card floats over the map with a driver header, status chip,
  job reference, vertical stop timeline, and an attention section.
- **Parcel tray:** unassigned jobs are horizontal paper cards with origin,
  destination, priority, stop count, and an orange assign affordance.
- **Dispatch Board:** cream timeline lanes, orange job blocks, clear driver
  rows; the dense planning screen keeps its existing interaction model.
- **Customer Tracking:** warm configuration panels plus a white-label customer
  preview with orange progress states, aligned to the same palette.
- **Login:** split composition — dark brand panel with the operational proof
  points, cream sign-in form with orange primary action.

## Responsive behaviour

- Desktop (≥1280 px): full pill nav in the top bar.
- Tablet (1024 px): nav becomes a compact second row; KPI cards wrap to four
  columns; the floating vehicle card remains over the map.
- Mobile: navigation scrolls horizontally; the floating card is hidden so the
  map and tray keep priority.

## Implementation

- `apps/web/src/index.css` — tokens, map inversion, Leaflet controls.
- `apps/web/src/app/App.tsx` — shell, live composition, vehicle timeline.
- `apps/web/src/features/dispatch/JobCard.tsx` — parcel card.
- `apps/web/src/features/auth/LoginScreen.tsx` — split login.
- `apps/web/src/features/customer-tracking/*` — aligned tracking palette.
- Shared primitives: `KpiCard`, `Panel`, `StatusChip`.

## Evidence

Captured at 1440×960 and 1024×768 against the LAN deployment. Dispatcher,
map-quality, auth, and demo suites remain the functional acceptance gates.
