# 51 - Driver map: route following and geofence sync

Date: 2026-11-04
Status: done (verified on Phone 1)

## Purpose

Make the driver map operationally complete: the driver sees where they are
on the route, what comes next and how far, and which geofences they are in -
saving time, fuel and exception cost.

## Changes

### API (driver-scoped, read-only)

1. `GET /v1/driver/route-geometry` gains per-stop `legDistanceM` and
   `arrivalAt` (from route_stops) so the client can compute route distance
   and ETA without downloading the whole plan.
2. New `GET /v1/driver/geofences`: the tenant's enabled fences that apply to
   this driver (empty scope = all), with `inside` state for their vehicle.

### Native (modular, offline-first unchanged)

- `RouteProgress` (pure): project a position onto the polyline, find the
  next incomplete stop, remaining route distance, ETA. Unit-tested.
- `GeofenceInfo` (pure): parse the fence feed. Unit-tested.
- `RouteMapActivity`:
  - driver position marker from the latest stored fix
  - Follow toggle (camera tracks the driver)
  - completed route segments grey, remaining orange
  - next-stop highlight ring
  - navigation HUD: next stop, remaining distance, ETA, remaining count
  - geofence polygons + inside/outside chip

## Acceptance criteria

1. Next stop, distance and ETA shown and update as the driver moves.
2. Follow keeps the position centred; user pan cancels follow.
3. Completed portions render differently from remaining.
4. Geofences render and reflect server state.
5. Existing suites unchanged (gate green).
