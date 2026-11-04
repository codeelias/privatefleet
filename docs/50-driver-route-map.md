# 50 - Driver route map (offline-first)

Date: 2026-11-04
Status: in progress (planned, modular)

## Purpose

Give the driver a map of their published route: true route line, tappable
stops with full details, evidence upload (photo, signature, note) and
delivery completion - while remaining lightweight and usable on very poor
networks.

## Architectural decisions

1. **MapLibre Native Android** (no WebView/JS): vector basemap from
   OpenFreeMap liberty (attribution included), compliant tile policy.
2. **Offline-first tiles**: a Greater London region (zoom 0-12) is
   downloaded once on first use and kept forever; refreshed incrementally
   in the background only when connectivity allows. No tiles cached + no
   network = stay in the existing list UI (the map screen exits with a
   message).
3. **List UI remains primary**: the map is an opt-in screen opened by a
   button; it never blocks the queue workflow.
4. **Route data**: new read-only driver endpoint
   `GET /v1/driver/route-geometry` returns the published route line and
   stop sequence; actions (arrive/complete/evidence) reuse the existing
   offline command and evidence queues.

## Modules

| Module | Responsibility |
|---|---|
| `RouteGeometry` | pure model + JSON parsing (points, stops); JUnit-tested |
| `MapCacheManager` | offline region ensure/download/refresh + state callback |
| `RouteMapActivity` | UI only: map lifecycle, markers, stop sheet, actions |
| `ApiClient.routeGeometry()` | driver endpoint client |
| API `driver/routes.ts` | the endpoint (read-only, driver-scoped) |

## Acceptance criteria

1. Map opens with the route line and numbered stop pins.
2. Tap pin -> detail sheet (reference, type, address, status, window).
3. Photo / signature / note upload and Complete work through the offline
   queue.
4. First download progress is visible; afterwards the map works offline.
5. With no cache and no network, the app remains in list mode.
6. Existing screens and suites unchanged (gate green).

## Files

```text
apps/driver-native/.../RouteMapActivity.java
apps/driver-native/.../RouteGeometry.java
apps/driver-native/.../MapCacheManager.java
apps/driver-native/.../ApiClient.java (routeGeometry)
apps/api/src/modules/driver/routes.ts (route-geometry)
```
