# 39 - Customer Edge: navigation, follow, tracking and geofencing

Date: 2026-11-02  
Scope: dispatcher map, customer tracking portal, geofencing.

## 1. Smarter navigation ETA

`engine/navigation.ts` now blends the live device speed with the published leg
duration instead of trusting the plan alone:

```text
plannedSpeed = remainingDistance / plannedDuration
blendedSpeed = plannedSpeed * (1 - weight) + liveSpeed * weight
weight: high confidence 0.6, medium 0.35, low/unknown/stale 0
```

- ETA recomputed from the blended speed when the device reports a plausible
  speed (>0.5 m/s, <=40 m/s).
- Low-confidence or stale fixes fall back to the planned duration, never to a
  guess.
- The map HUD labels the basis: `ETA 16:12 live` vs planned-only.
- Tests cover blending and the low-confidence fallback.

This is a speed-based adjustment. It is **not** a traffic forecast; no traffic
provider is integrated and none is claimed.

## 2. Off-route remediation

Heads-Up items for off-route or projected-late work now have
**Re-route driver**:

- calls the single-driver live optimization endpoint
- the solver starts from the vehicle's last GPS fix and only pending stops
- shows the revised distance and duration before any change
- publishing is a separate explicit step and uses the server's stale-version
  protection
- after publishing the fleet query is invalidated so map/board/Heads-Up
  re-evaluate

Live verification (proposal only, not published):

```text
B06-004 projected 311 min late
revised distance 103.2 km / revised duration 252 min
```

## 3. Follow camera

- **Auto-follow** toggle added to the map camera controls; persisted across
  sessions.
- Selecting a vehicle (pin or list) switches the camera to follow when
  auto-follow is on.
- Follow still includes bearing-up (vector), adaptive zoom and speed-based
  look-ahead; user drag exits follow.
- Raster bearing remains explicitly unavailable rather than faked.

## 4. Customer-facing tracking accuracy

Public tracking response now includes:

```text
etaMethod:       planned | live
etaConfidence:   high | medium | low   (fix age based)
delayStatus:     on_time | late | unknown
remainingStops
lastUpdateAt
```

- `delayStatus` compares the planned arrival with the drop-off window end.
- The live public page shows a **Running late / On time** banner, remaining
  stop count and seconds-since-last-update.
- The branded portal preview shows driver, vehicle, live-vs-planned label and
  delay state.

Live verification:

```text
job B01-005
etaMethod planned
etaConfidence high
delayStatus on_time
remainingStops 1
driverName Mo Khan
```

## 5. Geofencing administration

Evaluation already runs on every telemetry sample (PostGIS `ST_Contains`,
idempotent enter/exit events, dispatcher alerts). What was missing was the
operator lifecycle:

- `PATCH /v1/geofences/:id` — rename, enable/disable
- `DELETE /v1/geofences/:id` — remove zone (cascade clears per-vehicle state)
- new web client methods
- **Geofencing panel** on Exceptions & Alerts:
  - create a zone from name + GeoJSON polygon
  - enable/disable and delete
  - vertex summary and created time
  - driver accounts are rejected by the API (staff only)

Tests cover list, disable, driver-forbidden and delete, in addition to the
existing enter/exit evaluation gate.

## Verification

- Map/Heads-Up engine tests: 48 passed
- API geofence/public-tracking tests: passing
- Full E2E: 20 passed / 20 skipped
- API suite: 100 passed
- Production checks: tracking fields verified; re-route proposal verified;
  customer-update dialog verified

## Remaining honest gaps

- No live traffic provider; ETA blending is speed-based.
- No SMS/email sender; customer messages are prepared for copy or the
  operator's existing channel.
- Geofences are not drawn on the map yet (management only).
- The portal delay status uses the planned ETA until a live-blended server ETA
  is shipped.
- Raster bearing rotation is unavailable; vector is required for heading-up.
