# 40 - Visual geofence map editor

Date: 2026-11-02  
Scope: dedicated Geofences screen for dispatchers.

The editor runs on the same OpenFreeMap vector basemap as the live map, so
the operator sees real roads while drawing. No volunteer OpenStreetMap tile
requests are made.

## Interaction model

Coordinates are gone from the operator workflow. The fence is drawn on the
map:

- **Draw new fence** arms the map; each click adds a vertex.
- Vertices are **draggable**; dragging a vertex reshapes the fence live.
- Small midpoint handles insert a new vertex between two existing ones.
- Right-click a vertex removes it (at least three remain).
- **Undo / Redo** keep a 60-step vertex history.
- Fences on the map are clickable; clicking opens them for editing.
- Vehicle positions are shown as pins; a pin inside the drawn shape is green.
- **Select drivers inside** scopes the fence to every driver whose latest
  position is inside the current shape.
- Driver scope can also be set per-driver from the list. An empty scope means
  the fence is evaluated for **every vehicle**.
- An optional linked job powers the customer "in your area" signal.

## Validation

Saving is rejected with a specific message when:

- fewer than three vertices
- two vertices share the same point
- the boundary crosses itself
- the shape is smaller than 100 m²

Live feedback shows the polygon area while drawing.

## Server behaviour

- `POST /v1/geofences` accepts `driverIds` (validated tenant-scoped).
- `PATCH /v1/geofences/:id` now accepts `geojson` and `driverIds`, so a fence
  can be reshaped after creation.
- Telemetry evaluation skips fences whose `driver_ids` do not include the
  reporting vehicle's driver; an empty list still means all vehicles.
- Enter/exit events and alerts carry the linked `job_id`.

Migration: `0014_legal_shooting_star` (`geofences.driver_ids jsonb`).

## Verification

```text
geometry unit tests:         5 passed (round-trip, area, self-intersection,
                             containment, midpoints)
geofence API tests:          3 passed (lifecycle, staff-only, driver scoping)
E2E editor test:             draw, undo, cancel on the map (pass)
production drive:            vector basemap rendered, drew a polygon, saved it,
                             verified the stored GeoJSON ring, deleted it
                             with zero requests to volunteer tile servers
full E2E suite:              21 passed / 21 skipped
map/heads-up/geofence tests: 53 passed
API suite:                   101 passed
```

Production-verified stored geometry (before cleanup):

```text
[-0.198784,51.538008] → [-0.127716,51.538008] →
[-0.127716,51.50746] → [-0.198784,51.50746] → closed
```

## Honest limits

- Single-ring polygons only; holes and multipolygons are not supported yet.
- No satellite basemap in the editor; it uses the OpenFreeMap vector basemap.
- GeoJSON file import/export is not implemented; pasted GeoJSON remains
  available in the Exceptions & Alerts panel for advanced cases.
- Vertices are edited on the vector engine (MapLibre + OpenFreeMap).

## Files

```text
apps/web/src/features/geofences/GeofenceEditor.tsx
apps/web/src/features/geofences/engine/geofence-geometry.ts
apps/web/src/features/geofences/engine/geofence-geometry.test.ts
apps/e2e/tests/geofence-editor.spec.ts
apps/api/src/modules/geofences/routes.ts
apps/api/src/modules/tracking/service.ts
apps/api/drizzle/0014_legal_shooting_star.sql
```
