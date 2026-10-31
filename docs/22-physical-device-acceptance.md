# Physical Android Device Acceptance (Stage 3 pre-requisite)

Purpose: verify the existing Expo driver app and real GPS ingestion on two
physical Android phones before any Kalman/map-matching work. This is
foreground/telemetry/POD acceptance; native background tracking is a later
build.

## Device prerequisites

1. Android 10 or newer (verified: two Galaxy S22 SM-S901B, Android 16).
2. Developer options enabled (tap Build number 7x).
3. USB debugging on; accept the RSA fingerprint prompt on the phone.
4. Phone USB-tethered to the Windows machine running adb.

## Network topology (phones do not resolve .home.arpa)

The phones cannot resolve `api.privatefleet.home.arpa`. The working tethered
path is:

```text
app  http://127.0.0.1:4000
  -> adb reverse tcp:4000 tcp:4010  (device -> PC)
  -> ssh -L 4010:127.0.0.1:4000 deploy@192.168.1.128  (PC -> host)
  -> API 127.0.0.1:4000 on the host
```

Setup (run on the Windows PC):

```powershell
adb -s <serial> reverse tcp:4000 tcp:4010
adb -s <serial> reverse tcp:8081 tcp:8081
ssh -p 22 -N -L 4010:127.0.0.1:4000 -i "$HOME\.ssh\deploy_auto_ed25519" deploy@192.168.1.128
```

Metro (bundle with tethered API base, offline doctor):

```powershell
$env:EXPO_PUBLIC_API_URL='http://127.0.0.1:4000'
$env:EXPO_OFFLINE='1'
pnpm --filter @privatefleet/driver-expo start --port 8081 --localhost
```

Local port 4000 on the PC is occupied by an unkillable demo API process owned
by another user; the relay therefore uses local port 4010.

## Install

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File scripts/phone-install.ps1
```

The debug build bundles the Caddy internal CA in its debug trust store and
allows cleartext to 127.0.0.1, so no manual CA install is required.

## Acceptance checklist (record each as PASS / FAIL / NOT VERIFIED)

1. App installs and launches.
2. Login with a driver ID + PIN.
3. Shift start shows the shift state.
4. Location permission granted; **GPS accuracy and fix time recorded**.
5. Vehicle pin on the dispatcher leaves stale state (fresh telemetry visible).
6. Screen off for 5 minutes with app foregrounded: positions keep arriving.
7. App to background for 5 minutes: record whether telemetry continues.
8. Wi-Fi off for 2 minutes, then on: pending actions replay.
9. Force-stop, relaunch: session restores, no duplicate commands.
10. POD photo + signature upload against a real job.

## Known gap

The Expo app has **no location module**; it reports actions and evidence but
not GPS. Items 4-7 require the native Kotlin tracking module. Everything else
is testable with the current build.

## Evidence to save

- `adb shell getprop ro.build.version.release`
- dispatcher screenshot with live pin for each device
- timestamps of the first and last telemetry row per device
- any 4xx/5xx from `/v1/telemetry`

## Stage 3 consequence

- Stage 3A (display-only smoothing) may start once two devices produce a real
  GPS sample set with accuracy/speed/heading.
- HMM map matching and camera-follow remain deferred until the sample set
  shows measurable mis-snapping.
