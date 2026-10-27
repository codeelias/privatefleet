# 06 - Driver App Architecture

**Status:** Draft v1 - for approval.
**Decisions:** [ADR-0009](adr/0009-expo-driver-app.md).
**Related:** [08](08-domain-model-and-events.md) (commands/conflicts), [09](09-realtime-tracking.md) (location ingestion), [11](11-security-and-compliance.md) (auth, media).

## 6.1 Stack

Expo (managed workflow) + TypeScript (strict)  /  expo-router  /  TanStack Query  /  expo-sqlite (durable offline command queue + cache)  /  Socket.IO client  /  expo-location / expo-task-manager (foreground in Phase 3, background in Phase 4)  /  MapLibre adapter with platform split: MapLibre GL JS on web (demo), `@maplibre/maplibre-react-native` on native  /  `@privatefleet/contracts` for all API/event shapes.

The **same app codebase runs the demo** (Expo web export in a browser on a tablet) **and the pilot** (native build). See [ADR-0009](adr/0009-expo-driver-app.md).

## 6.1b Human-centered mobile design - the driver's co-pilot

Drivers are operating vehicles or handling sensitive medical equipment. The app is a co-pilot, not a boss. Rules:

- **The "glanceable" rule.** The next instruction must be readable in under 1.5 seconds: massive typography, high-contrast buttons, zero unnecessary data on the active screen. If a field doesn't change the driver's next action, it doesn't belong on the execution screen.
- **Thumb-zone ergonomics.** Primary actions (Navigate, Arrived, Complete, Call Dispatch) live in the bottom 30% of the screen; secondary/administrative actions move to the top or into menus. Touch targets >= 48 px.
- **Slide-to-confirm.** Critical state changes (arrived at a hospital, stop complete) use a physical slider with **haptic confirmation** - pocket-proof accuracy plus tactile satisfaction. Every critical action shows a confirmation step before submission.
- **Offline confidence.** Entering a dead zone never shows a scary error: the UI shifts to a calm amber "Offline mode" banner - *"No signal. Your progress is saved locally and will sync automatically."* - with a pending-count and last-sync time. Reconnection animates back to green and visibly drains the queue ([6.4](#64-offline-first-design-the-honest-version)).
- **Respect for the driver's time.** No navigation into dead ends; server conflicts are presented with two clear options (discard / call dispatch), never a wall of JSON ([6.4](#64-offline-first-design-the-honest-version)). When GPS is stale, the app says so instead of pretending.

These rules are acceptance criteria for the driver screens: a screen that violates the glanceable rule or the thumb-zone rule fails review, no matter how correct the code is.

## 6.2 Structure

```
apps/driver/
+- app/                          # expo-router routes
|  +- (shift)/                   # shift home, queue, start/end shift
|  +- job/[jobId]/               # active stop execution
|  +- pod/                       # proof of service capture
|  +- settings/
+- features/
|  +- shift/                     # Screen 1: route queue, day summary, start shift
|  +- execution/                 # Screen 2: active leg, arrive/begin/complete
|  |  +- map/                    #   MapView.tsx + MapView.web.tsx (platform split)
|  +- pod/                       # Screen 3: camera, signature, skip-with-reason
|  +- sync/                      # offline queue, connectivity, conflict UI
+- shared/
|  +- api/                       # typed client (contracts)
|  +- realtime/                  # socket client + reconnect/recovery
|  +- db/                        # expo-sqlite schema + command-queue store
|  +- location/                  # location adapters (simulated in demo, GPS later)
|  +- ui/                        # thumb-friendly primitives (big buttons, slide-to-confirm)
```

## 6.3 The three driver screens

| Screen | Feature | Behaviour |
|--------|---------|-----------|
| 1. Shift Home & Route Queue | `shift` | Start/end shift; vertical queue of stops; next stop on top; address, time window, one-tap Navigate (hands off to Waze/Google/Apple Maps); day strip ("8 stops  /  42 mi  /  est. 5h 10m"); connectivity + sync-status banner; offline queue remains readable. |
| 2. Active Job & Navigation | `execution` | Embedded map with current leg; slide-to-confirm "Arrived at Pickup/Dropoff" (pocket-dial protection); on-scene timer; Call Dispatch quick action; issue reporting. |
| 3. Completion & Exceptions (POD) | `pod` | Camera capture; signature pad with clear-and-retry; "Skip stop" with mandatory reason code + optional photo; all actions write immutable job events via the server. |

Reference images: `screenshot/Today and Route.jpg`, `screenshot/Active Job.jpg`, `screenshot/Completion  Exceptions.jpg`.

## 6.4 Offline-first design (the honest version)

The app distinguishes a **local intention** from an **accepted server transition**. It never pretends a local change is already accepted.

### Command queue (expo-sqlite)

| Column | Purpose |
|--------|---------|
| `command_id` (uuid) | Stable idempotency identifier = `Idempotency-Key` sent to the API. |
| `type` | e.g. `arrive_stop`, `complete_stop`, `skip_stop`, `capture_pod`. |
| `job_id` / `stop_id` / `payload` | Target and data (reason codes, media keys pending upload). |
| `captured_at` | Device time the driver acted (server also records `received_at`). |
| `status` | `pending` -> `submitted` -> `accepted` / `conflict`. |
| `attempts` / `last_error` | Retry bookkeeping with backoff. |

The queue survives app restarts; media uploads (POD photos) are queued separately with presigned URLs obtained at upload time.

### Sync protocol

1. On reconnect (or new action), submit queued commands in order with their idempotency keys.
2. The API validates against **current** server state (the driver's assignment may have changed while offline).
3. Outcomes:
   - **Accepted** -> store the returned event/result, mark `accepted`.
   - **Duplicate** -> API returns the original stored result (idempotent replay); mark `accepted`.
   - **Conflict** (409) -> mark `conflict`, show a dedicated conflict screen with the current job state and two actions: *discard* (with explicit confirmation) or *call dispatch*.
4. **No last-write-wins for job states.** An offline driver never silently overrides a dispatcher who reassigned or force-closed the job. No vector clocks - a server-authoritative workflow with idempotent commands and explicit conflicts is simpler and verifiable.

The sync banner always shows: connected/offline, N pending, last successful sync time.

## 6.5 Location handling

- **Demo (Phase 1):** no GPS. The app consumes the simulated vehicle positions the API broadcasts; a demo panel on the tablet drives "arrive/complete" like a real driver.
- **Pilot (Phase 3+):** foreground location while the shift is active (5-10 s moving, coarser idle; accuracy + speed captured; battery-aware).
- **Phase 4:** background location via expo-task-manager with documented platform limits (OS may stop updates on app termination - expectations set with the pilot fleet; see blueprint and Expo docs). The server treats stale positions as stale, labelled in UI (see [09.7](09-realtime-tracking.md)).
- Tracking is **always** tied to an on-duty shift and only when the driver started shift and is assigned to the vehicle - privacy-by-default (see [11.6](11-security-and-compliance.md)).

## 6.6 Auth & security

- Same rotating access/refresh token flow as the web app; tokens stored in secure storage (`expo-secure-store`), never in SQLite.
- The API validates every command against the driver's current assignment and membership; a driver cannot act on another tenant's or driver's jobs (server-enforced).

## 6.7 Deployment

- **Demo:** `expo export --platform web` served statically by Caddy on the demo VPS.
- **Pilot:** EAS Build (Android APK/AAB; iOS via EAS or a Mac when needed) - Expo's cloud build avoids local native toolchain pain on Windows dev machines. OTA updates only after the pilot proves the need.




