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

## Alternatives considered
- **Mapbox/MapTiler/Stadia:** polished and SLA-backed, but metered costs arrive before revenue; revisit at scale.
- **Self-hosted TileServer-GL:** full control, real operational load (extract updates, storage, bandwidth); unjustified at pilot scale.
- **Public OSM tile server:** policy-limited, not production infrastructure; rejected.



