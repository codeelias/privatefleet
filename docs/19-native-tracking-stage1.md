# Stage 1 - Native Kotlin Tracking (approved, corrected)

**Status:** APPROVED 2026-10-30, subject to the five mandatory corrections below.
**Scope:** Stage 1 only. No Activity Recognition, stationary pausing, geofence
wake-up, Kalman filtering, backend changes or unrelated refactoring.

## Architecture

```text
Expo/RN driver UI (unchanged screens, POD, auth)
   |  bridge: configure / setSession / getSession / refresh /
   |          startTracking / stopTracking / status / events
   v
TrackingAuthModule (ReactContextBaseJavaModule)
   |  single credential authority for Android
   v
TrackingCredentialStore (Android Keystore AES-GCM encrypted JSON session)
   |
TrackingService (foreground, type=location, persistent notification)
   |-- FusedLocationProviderClient (interval 10s / fastest 5s / displacement 10m)
   |-- LocationPointQueue (SQLite, FIFO by insertion _id, quarantine state)
   |-- TrackingUploader (single thread, FIFO batches <= 20, backoff 5s -> 300s)
   `-- TrackingSessionRefresher (single-flight /v1/auth/refresh)
```

## Mandatory corrections incorporated

1. **Authentication security**
   - No tokens in ordinary SharedPreferences. A Keystore-backed AES-GCM
     `TrackingCredentialStore` encrypts the whole session JSON; the ciphertext
     file lives in app-private storage.
   - Atomic rotation: one transaction-like write updates access + refresh +
     expiry together.
   - Single-flight refresh shared by the JS bridge and the uploader. On Android
     the JS layer delegates refresh to the native module; no competing refresh
     implementation.
   - No token values are logged or emitted in diagnostics or RN events
     (refresh events carry only a version counter).
   - Web and iOS keep their existing refresh paths unchanged.

2. **Native project ownership**
   - `apps/driver-expo/android/` is committed and is the source of truth.
   - `.gitignore` entries for the native directories are removed.
   - `expo prebuild --clean` is NOT run after manual native changes unless the
     changes are first expressed in config plugins. CNG regeneration is not
     claimed to be safe.

3. **Queue and acknowledgement correctness**
   - Queue order key is the SQLite auto-increment `_id`; GPS `captured_at` is
     preserved verbatim and never modified to pass stale rejection.
   - `POST /v1/telemetry` batches of at most 20 samples (contract max 50).
   - The uploader inspects the actual per-sample response (`results[]`):
     - `accepted` -> delete that point;
     - `stale` -> terminal only after recording the server verdict (drop from
       the send queue, keep a diagnostic counter/event);
     - `invalid` -> moved to `status='quarantined'`; the row is retained and
       never silently deleted;
     - `429` / `5xx` / network failure -> keep queued, backoff, retry;
     - `401` -> one coordinated refresh, one retry; failure keeps the queue.
   - New live positions never overtake older pending points (single ordered
     queue, uploader reads oldest first).
   - Partial-batch behaviour is proven because the endpoint returns a verdict
     per sample; the test will demonstrate mixed accepted/stale in one response.

4. **Foreground service and shift lifecycle**
   - The service always supplies its required persistent notification.
   - `POST_NOTIFICATIONS` denial does not block service start; the notification
     is supplied regardless, and the permission is requested but not required.
   - Before start: check location permission, location services enabled and the
     foreground-service permissions (Android 14+ `FOREGROUND_SERVICE_LOCATION`).
   - Tracking starts only after `POST /v1/driver/shift/start` succeeds.
   - Startup failure surfaces through an RN event and leaves the shift in the
     existing lifecycle; an active shift is never silently tracked-less.
   - Persisted `tracking_enabled` + valid session restore tracking after
     ordinary process recreation; explicit force-stop is never claimed.
   - **No partial wake lock in Stage 1.** Revisit only with physical-device
     battery measurements.

5. **Scope** as listed above; nothing beyond Stage 1.

## Files

- `android/app/src/main/java/com/privatefleet/driver/tracking/`
  - `TrackingCredentialStore.kt`
  - `TrackingSessionRefresher.kt`
  - `LocationPointQueue.kt`
  - `TrackingUploader.kt`
  - `TrackingService.kt`
  - `TrackingAuthModule.kt`
  - `TrackingPackage.kt`
- `MainApplication.kt` - package registration
- `AndroidManifest.xml` - permissions + service
- `app/build.gradle` - play-services-location
- `apps/driver-expo/src/native/tracking.ts` - typed bridge + permissions
- `apps/driver-expo/src/api.ts` - Android session/refresh delegation
- `App.tsx` - shift start/stop integration
- `docs/19-native-tracking-stage1.md` - this plan

## Verification

- Build debug APK; install on the available emulator.
- Emulator evidence: service start/stop, `adb emu geo fix` -> `location_points`,
  offline queue growth and FIFO replay, per-sample ack handling, refresh with
  the JavaScript runtime stopped (local short-TTL dev API instance for the
  test only; backend contract unchanged).
- Physical-device evidence is reported separately as NOT VERIFIED until a real
  device runs the screen-off, 30-minute outage, process-termination and
  token-expiry scenarios.

## Deliverables

Changed files, build/install commands, PASS/FAIL/NOT VERIFIED test results,
and the commit hash.

## Traccar-informed feature adoption roadmap (preference level)

These are the mechanisms worth learning from Traccar and bringing into
PrivateFleet, staged so each stage is built on the proven previous one. Stage 1
is the only stage currently in implementation.

| # | Traccar source to study | Mechanism we adopt | PrivateFleet stage | Customer benefit |
|---|---|---|---|---|
| 1 | FusedLocationSource | Fused Location Provider with interval / fastest / displacement | Stage 1 | Accurate, low-cost positions |
| 2 | ForegroundServiceHolder | `location` foreground service + persistent notification | Stage 1 | Survives backgrounding and screen-off |
| 3 | DatabaseQueue + HttpUploader | SQLite FIFO queue by insertion id; delete only on per-sample ack; backoff 5s-300s | Stage 1 | No lost points across network loss |
| 4 | Traccar refresh pattern (adapted) | Keystore-backed single session authority; single-flight refresh usable without the JS runtime | Stage 1 | Uploads stay authenticated after 15-minute token expiry |
| 5 | TrackerEngine separation | GPS acquisition / filtering / persistence / upload as separate components | Stage 1-2 | Explainable, testable reliability |
| 6 | NetworkManager recovery | Connectivity-aware uploader, wake on network restore, recovery after ordinary process termination | Stage 2 | Automatic replay without driver action |
| 7 | WakeLockHolder | Partial wake lock ONLY if measured physical-device tests show it is required | Stage 2 (conditional) | Reliability without unmeasured battery cost |
| 8 | ActivityRecognitionDetector | Activity Recognition transitions: STILL / IN_VEHICLE / WALKING / RUNNING | Stage 3 | Battery-friendly tracking without drift points |
| 9 | GeofenceDetector (client) | Stationary geofence exit used to wake GPS after a stationary pause | Stage 3 | Resumes promptly when the vehicle moves |
| 10 | LocationFilter | Threshold acceptance: distance OR elapsed-time OR heading change; stationary/moving transitions; heartbeats | Stage 3 | Fewer junk points, cleaner history |
| 11 | Traccar trip/stop classification | Server-side trip and stop segmentation from location_points (movement distance + minimum stop duration; Traccar reference defaults 200 m / 180 s, tuned for courier work) | Stage 4 | Trustworthy idle-time, arrival and dwell metrics |
| 12 | Geofence + event evaluation (server) | PostGIS enter/exit evaluation writing into the existing alerts/outbox | Stage 4 | Operational alerts without a second service |
| 13 | Notification/tracking patterns (adapted) | Customer-facing live tracking and notifications driven by PrivateFleet job events | Stage 4 (product) | Fewer "where is my delivery" calls |
| 14 | Planned-vs-actual reporting | Planned route/ETA versus actual track/arrival/failure reports | Stage 4 (product) | Operator performance and exception visibility |

Not adopted from Traccar: its server, protocols, frontend, data model, Kalman
claims (not present in current SDK), raw-accelerometer heuristics, and any
claim of recovery from explicit user force-stop.

Kalman filtering is explicitly deferred: adopt it only if physical-device
GPS-noise measurements demonstrate the threshold filter is insufficient.

## Gates that move between stages

- Stage 2 starts only after Stage 1 passes on a physical device.
- Stage 3 starts only after Stage 2 reliability evidence exists.
- Stage 4 is server-side and starts independently once Stage 1-2 telemetry is
  trustworthy; it does not gate customer tracking or reporting on Stage 3.

The Traccar hardware gateway decision remains NOT NEEDED YET; it becomes
justified only by a signed customer requirement for installed GPS hardware.

