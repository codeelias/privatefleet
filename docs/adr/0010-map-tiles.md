# ADR-0010 - Map tiles: OpenFreeMap initially

**Status:** accepted (2026-10-27)

## Context
MapLibre renders tiles but supplies none. Public OSM tiles are not a production service; Mapbox/Google pricing can consume the margin. The demo must look premium at zero cost, and the commercial story promises "no Google Maps tax".

## Decision
Use **OpenFreeMap** (free, no API key, OSM-derived vector tiles) for demo/dev and early pilot traffic, styled to the dark operations theme. Review the decision when real traffic, uptime needs, or SLA demands appear ([15.6](../15-infrastructure-and-deployment.md)).

## Consequences
- Zero tile cost through the pilot phase; no key management.
- Trade-offs: community-grade SLAs - acceptable for demo/dev; the review trigger is explicit so prod decisions are made on data, not inertia.
- Geocoding is a separate decision deferred to Phase 4+ (candidate: Nominatim/Photon or a commercial geocoder when address volumes justify it).

## Provider pluggability (amended 2026-10-28)
The renderer is not the provider. Web map sources are centralised in
`apps/web/src/features/live-map/map-config.ts` and driven by `VITE_MAP_*`
variables; changing tile host or style is configuration, never a change to
markers, route overlays, geofences or dispatch interactions. Selection order:

1. Explicit `VITE_MAP_*` configuration.
2. MapTiler defaults when `VITE_MAPTILER_KEY` is present (validated before use - a rejected key answers 403 with a placeholder PNG).
3. Approved B2 defaults: OpenFreeMap `bright` then `liberty` vector styles, OpenStreetMap raster tiles.

The full stack split (per the approved architecture):

| Concern | Technology | Phase |
|---|---|---|
| Web rendering | MapLibre GL JS (Leaflet raster fallback where WebGL is unavailable) | 1 / 6 |
| Demo + development tiles | OpenFreeMap (vector); OSM raster as no-WebGL fallback | 1 |
| Native driver maps | MapLibre React Native (Expo dev build, not Expo Go) | 6 |
| Geospatial queries, geofences | PostgreSQL + PostGIS | 3+ |
| Road routes and travel-time matrices | OSRM | 3+ |
| Multi-vehicle optimisation | VROOM | 3+ |
| Future self-hosted vector tiles | PMTiles or self-hosted OpenFreeMap | production |

OSRM and VROOM provide routing and optimisation; they are not the rendered
map. OpenFreeMap's public service has no SLA: it stays the demo/dev choice
until real traffic and reliability requirements are measured, at which point
a hosted provider or self-hosted tiles replace it. The community OSM tile
server is demo-only and never production infrastructure.

## Alternatives considered
- **Mapbox/MapTiler/Stadia:** polished and SLA-backed, but metered costs arrive before revenue; revisit at scale.
- **Self-hosted TileServer-GL:** full control, real operational load (extract updates, storage, bandwidth); unjustified at pilot scale.
- **Public OSM tile server:** policy-limited, not production infrastructure; rejected.



