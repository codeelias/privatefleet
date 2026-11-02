# 36 - Map positioning, camera and navigation completion

Date: 2026-11-02  
Scope: Live Operations map, Stages 1-5.

## Stage 1 - route integrity

The publication boundary now rejects:

- leg count different from `waypoints - 1`
- leg sequence different from its array index
- leg `fromWaypointId` / `toWaypointId` not matching adjacent waypoints
- a leg whose first point is not the previous leg's end
- a first leg that does not start at the route origin
- fewer than two points or non-finite coordinates
- negative or non-finite distance/duration
- duplicate stop identities

Implementation: `apps/api/src/modules/optimization/route-plan.ts`.  
Tests: 9 route-plan tests, including disconnected legs, NaN metrics and duplicate
stops.

Live published data validation:

```text
3 routes / 3 unique vehicles
31 waypoints, 30 legs each
0 id/sequence/connectivity mismatches
stop sequences 1..30, unique
```

## Stage 2 - visual hierarchy

### Vector

- completed: grey, thin
- exception: amber, dashed
- next: strong blue, 6 px
- remaining: blue, 4 px
- unselected: dimmed, status colour retained
- selected: white casing + low-opacity blue halo **under** the status line

The previous solid selected line covered the status hierarchy. It is now a halo,
so completed/next/remaining remain visible on the selected route.

### Raster

Every leg is drawn as its own Leaflet polyline with the same status colours,
dashes and selection/dimming. Legacy routes without legs still render one
polyline and keep the previous selection weights.

### Basemap fallback

CARTO's unauthenticated raster tiles now contain an `API KEY REQUIRED`
watermark. The keyless raster fallback is therefore OpenStreetMap standard
tiles with attribution. This is suitable for the LAN pilot / low volume; a
licensed tile contract is still required for high-volume commercial use.

Both dark and light route palettes are validated through the theme toggle and
Playwright basemap tests.

## Stage 3 - positioning

### Data

`VehicleDto` now exposes optional:

```text
accuracyMetres
headingDeg
speedMps
```

The API reads these from the newest `location_points` row per vehicle, rather
than only the coarse vehicle snapshot.

### Filter

`engine/positioning.ts`:

- projects a fix onto the nearest planned route segment
- preserves leg index, leg progress, route progress and remaining distance
- high confidence: accuracy <= 15 m, age <= 15 s, snap distance <= 25 m
- medium: accuracy <= 50 m, age <= 45 s, snap distance <= 60 m
- stale/unknown: low, and never snapped
- rejects an implausible >400 m jump within a short interval
- smooths accepted fixes and headings (shortest-angle interpolation)
- leaves the raw fix untouched when it is too far from the planned route

The marker shows a confidence dot; the follow control shows confidence and
accuracy. Stale positions remain grey/dashed and never claim a fresh fix.

Tests: 9 positioning tests, including the API timestamp form (`+00`).

## Stage 4 - camera

`engine/camera.ts` provides a pure camera plan:

- follow selected vehicle
- north-up or heading-up (vector only)
- adaptive zoom: 16 at walking speed, 15.1 at 5 m/s, 14.2 at 12 m/s,
  13.8 at 18 m/s
- look-ahead 18-70 m based on speed
- overview fits all published route geometry
- user drag exits follow mode

Raster cannot rotate natively; the bearing control is disabled with an explicit
tooltip rather than pretending. Follow and adaptive zoom still work.

Tests: 3 camera tests plus the `map-camera` Playwright acceptance test.

## Stage 5 - navigation intelligence

### Routing data

OSRM `steps=true` was already requested; the adapter previously discarded the
step metadata. It now preserves, per leg:

```text
instruction
maneuver
modifier
exit (roundabouts)
roadName
distanceM
durationS
location
```

The route-plan builder persists these on the versioned route leg, and the
contracts include `RouteStep`.

### Navigation read model

`engine/navigation.ts` derives:

- next manoeuvre
- distance to that manoeuvre
- remaining route distance
- remaining duration
- ETA
- stop progress in the HUD

Legacy routes without steps show **"No turn instructions for this route"**
rather than inventing a turn. Remaining distance and ETA still render.

### Backfill

Existing routes predated the step contract. A one-off backfill requested each
leg from the local OSRM instance, validated the returned distance against the
stored leg distance, backed up all route legs, and wrote step metadata only.

```text
routes updated: 3
legs updated:   87
legs skipped:   3 (distance tolerance)
backup:         C:/PrivateFleet/logs/route-legs-backup-2026-11-02T11-43-03.236Z.json
```

No geometry, route version, waypoint order or status changed.

### Live-blended ETA

From 2026-11-02 the HUD ETA blends live device speed into the remaining
published duration (weight 0.6 high / 0.35 medium confidence) and labels the
basis as `live`; low-confidence or stale fixes stay on the planned duration.
This is speed-based adjustment, not a traffic forecast.

### Wording

Raw OSRM types were not exposed. A formatter maps:

```text
new name + straight -> Continue straight on Upper Tollington Park
turn + left         -> Turn left onto Market Road
roundabout + exit 2 -> At the roundabout, take exit 2 onto High Street
arrive              -> Arrive at destination
```

Live HUD example after backfill:

```text
Continue straight on Upper Tollington Park
in 140 m
Stop 1/30 | Remaining 16.8 km | ETA 12:29
```

## Verification

- API tests: 99 passed
- Route/instruction tests: 14 passed
- Web map engine tests: 42 passed
- Map camera Playwright test: pass
- Full dispatcher/driver E2E: 20 passed / 20 skipped (3.5 min)
- Production HUD after backfill: turn instruction, distance, stop progress, remaining distance and ETA verified
- Desktop and 390 px map: no page overflow

## Remaining honest gaps

- Raster bearing rotation is unavailable; vector is required for heading-up.
- Three backfilled legs had distance disagreements and intentionally remain
  without instructions.
- Instructions are leg-level OSRM text, not lane-guidance or live rerouting.
- No off-route detection/reroute has been implemented yet.
- A licensed raster tile contract is required at commercial scale.
- Real-device GPS accuracy/heading/speed should be verified on the Android
  handset, not only the seeded simulator.

## Files

```text
apps/api/src/modules/optimization/route-plan.ts
apps/api/src/modules/routing/instruction.ts
apps/api/src/modules/routing/osrm.ts
apps/api/src/modules/routing/types.ts
apps/api/src/modules/fleet/pg-service.ts
apps/web/src/features/live-map/engine/positioning.ts
apps/web/src/features/live-map/engine/camera.ts
apps/web/src/features/live-map/engine/navigation.ts
apps/web/src/features/live-map/MapCanvas.tsx
apps/web/src/features/live-map/map-config.ts
```
