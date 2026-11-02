# Native Android client

Status: **pilot tracking/ops client**, not yet full POD parity.

Current pilot release: **1.0.6** (`versionCode 7`), signed with the
PrivateFleet release key.

Package: `com.privatefleet.driver.nativeapp`  
Path: `apps/driver-native`  
Language/UI: Java + platform Android widgets. No Expo, Metro, React Native,
WebView or JavaScript runtime.

## What it does

- PIN driver login against `https://pf-node.tail060a86.ts.net`
- durable access/refresh session encrypted with Android Keystore AES/GCM
- cold relaunch stays signed in without re-entering the PIN
- sign-out keeps only the last workspace/driver encrypted for prefill; the PIN is never stored
- in-app update prompt from the internal release manifest\n- driver Heads-Up banner for the next stop window (1.0.5)
- raw-GNSS quality + IMU EKF fused positioning at 10 Hz (1.0.6)
- Start shift / shift status
- Request more jobs (durable dispatcher request)
- Nearest-stop ordering (arrived pinned first, completed/skipped/failed excluded)
- Responsive pagination: 3 stops per page on phones, 6 on tablets, Previous/Next
- Card-based job/stop UI with status chips and distance from the last GPS fix
- Native Arrive / Complete actions with recipient proof
- Native signature capture and upload
- Native failed-delivery reporting (reason code)
- Native camera/photo evidence (MediaStore capture, resize, JPEG upload)
- Durable offline command queue with idempotent retry
- Foreground location service (`TelemetryService`) using Android
  `LocationManager`:
  - GPS + network providers
  - 10 s / 15 s time-based updates, 0 m distance for the pilot
  - accuracy filter â‰¤150 m
  - POST `/v1/telemetry` with the same contract as the Expo client
  - foreground-service notification, wake lock, START_STICKY
  - continues when the screen is off
- Sign out stops tracking and clears the session

## Verified evidence

Physical Galaxy S22, Android 16, Tailscale connected:

```text
second phone R5CWB0BR3BP (SM-S901B) installed 1.0.4 (1.0.5 install pending)
PIN login as Mo Khan succeeded
25 assigned jobs
background service isForeground=true
22 location points; latest 2026-11-02 02:53 UTC
force-stop + relaunch restored the session without login
sign-out -> login prefilled tenant + driver; re-login started tracking

native app installed and launched
PIN login succeeded
shift: on_route Â· 19 jobs
foreground service: isForeground=true
screen-off test: 17 â†’ 25 location_points rows in ~80 s
latest point captured while screen was off
native Arrive: PASS
dropoff status changed pending â†’ arrived
native Complete: PASS (recipient name)
dropoff status changed arrived â†’ completed
native signature upload: PASS (stop_evidence kind=signature)
native photo upload: PASS (stop_evidence kind=photo)
offline arrive: queued with network disabled
offline queue sync: PASS (queue [] and server stop arrived)
nearest ordering: PASS (arrived pinned, pending sorted by distance)
pagination: PASS (Page 1 of 10 - 29 stops, Next -> Page 2, Previous -> Page 1)
encrypted session: PASS (relaunch restored the signed-in session)
Keystore AES/GCM: PASS (no caller-supplied IV)
offline signature evidence: queued with network disabled; synced on reconnect
server signature evidence count: 30 -> 31
FLAG_SECURE: enabled
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
- BACKGROUND location (user selected â€œAllow all the timeâ€)
- POST_NOTIFICATIONS
- FOREGROUND_SERVICE + FOREGROUND_SERVICE_LOCATION
- WAKE_LOCK

## Known limitations

- Failed-delivery reporting uses a reason picker but no failure photo.
- Evidence uploads are queued offline and stored as encrypted app-private files;
  they sync before later commands in queue order.
- Native actions use one-shot HTTP; the durable offline command queue is not
  implemented in this client.
- No native failure-photo capture yet.
- Queue/session/evidence are encrypted at rest with an Android Keystore AES/GCM key.
- No certificate pinning, root/tamper detection or biometric gate yet.
- Battery impact of time-based updates must be measured over a full shift;
  switch to distance-based updates once movement testing is complete.
- Force-stop by the user still prevents tracking; Android does not restart a
  force-stopped app.
- API base is compiled into `BuildConfig`; a change requires a rebuild.
- The native client currently targets the Tailscale HTTPS endpoint. LAN access
  would require rebuilding with `https://api.privatefleet.home.arpa`.

