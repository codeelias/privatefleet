# Native Android client

Status: **pilot tracking/ops client**, not yet full POD parity.

Package: `com.privatefleet.driver.nativeapp`  
Path: `apps/driver-native`  
Language/UI: Java + platform Android widgets. No Expo, Metro, React Native,
WebView or JavaScript runtime.

## What it does

- PIN driver login against `https://pf-node.tail060a86.ts.net`
- durable access/refresh session in SharedPreferences
- Start shift / shift status
- Request more jobs (durable dispatcher request)
- Refresh queue and render jobs/stops
- Native Arrive / Complete actions with recipient proof
- Foreground location service (`TelemetryService`) using Android
  `LocationManager`:
  - GPS + network providers
  - 10 s / 15 s time-based updates, 0 m distance for the pilot
  - accuracy filter ≤150 m
  - POST `/v1/telemetry` with the same contract as the Expo client
  - foreground-service notification, wake lock, START_STICKY
  - continues when the screen is off
- Sign out stops tracking and clears the session

## Verified evidence

Physical Galaxy S22, Android 16, Tailscale connected:

```text
native app installed and launched
PIN login succeeded
shift: on_route · 19 jobs
foreground service: isForeground=true
screen-off test: 17 → 25 location_points rows in ~80 s
latest point captured while screen was off
native Arrive: PASS
dropoff status changed pending → arrived
native Complete: PASS (recipient name)
dropoff status changed arrived → completed
```

Build:

```powershell
cd apps/driver-native
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The debug APK is signed with the local debug key. A release signing
configuration is required before distribution.

## Permissions

- FINE/COARSE location
- BACKGROUND location (user selected “Allow all the time”)
- POST_NOTIFICATIONS
- FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION
- WAKE_LOCK

## Known limitations

- No native photo/signature evidence capture yet; the current tenant policy
  requires only a recipient name, which the native client supports.
- No native skip/failed-delivery flow yet.
- Native actions use one-shot HTTP; the durable offline command queue is not
  implemented in this client.
- No offline command queue or durable local evidence store.
- Battery impact of time-based updates must be measured over a full shift;
  switch to distance-based updates once movement testing is complete.
- Force-stop by the user still prevents tracking; Android does not restart a
  force-stopped app.
- API base is compiled into `BuildConfig`; a change requires a rebuild.
- The native client currently targets the Tailscale HTTPS endpoint. LAN access
  would require rebuilding with `https://api.privatefleet.home.arpa`.
