# Physical Android Device Acceptance (Stage 3 pre-requisite)

Purpose: verify the existing Expo driver app and real GPS ingestion on two
physical Android phones before any Kalman/map-matching work. This is
foreground/telemetry/POD acceptance; native background tracking is a later
build.

## Device prerequisites

1. Android 10 or newer.
2. Developer options enabled (tap Build number 7x).
3. USB debugging on; accept the RSA fingerprint prompt on the phone.
4. Phone on the same Wi-Fi as `192.168.1.128`.
5. Phone must resolve `api.privatefleet.home.arpa` (same DNS as the Windows
   dispatcher already uses). If it does not, add a router DNS entry.

## Install

```powershell
# From this Windows machine, one phone at a time
adb devices
adb install -r C:\Temp\privatefleet-phone.apk
```

The debug build bundles the Caddy internal CA in its debug trust store, so no
manual CA installation is required. If the APK on the phone predates the
bundled CA, install the CA manually:

1. Copy `C:\Caddy\root.crt` to the phone's Download folder.
2. Settings > Security > Encryption & credentials > Install a certificate >
   CA certificate.
3. Select the file.

## Acceptance checklist (record each as PASS / FAIL / NOT VERIFIED)

1. App installs and launches.
2. Login with a driver ID + PIN.
3. Shift start shows the shift state.
4. Location permission granted; **GPS accuracy and fix time recorded**.
5. Vehicle pin on the dispatcher leaves stale state (fresh telemetry visible).
6. Screen off for 5 minutes with app foregrounded: positions keep arriving
   (expected: YES while app is foreground; screen-off may throttle).
7. App to background for 5 minutes: record whether telemetry continues
   (expected: unreliable without the native service - this is the gap).
8. Wi-Fi off for 2 minutes, then on: pending actions replay (commands/evidence).
9. Force-stop the app, relaunch: session restores, no duplicate commands.
10. POD photo + signature upload against a real job.
11. Record device model, Android version, battery impact over the session.

## Evidence to save

- `adb shell getprop ro.build.version.release`
- `adb shell dumpsys location | head` (or GPS provider status)
- dispatcher screenshot with live pin for each device
- timestamps of the first and last telemetry row per device
- any 4xx/5xx from `/v1/telemetry`

## Stage 3 consequence

- Stage 3A (display-only smoothing) may start once two devices produce
  a real GPS sample set with accuracy/speed/heading.
- HMM map matching and camera-follow remain deferred until the sample set
  shows measurable mis-snapping; they are not part of the phone test.
