# 38 - Native Android 1.0.5 release

Date: 2026-11-02  
Scope: native driver client, release 1.0.5.

## Change

1.0.5 adds a **driver-facing Heads-Up banner** above the stop queue:

- finds the pending/arrived stop with the earliest window end
- shows `Heads up: <job> window closes in N min` when within 45 minutes
- shows `window closed N min ago - contact dispatch before leaving` when overdue
- hidden when no stop has a near/overdue window
- window timestamps are parsed from the driver queue's ISO/offset values
- no new permissions, no WebView, no JavaScript runtime

This is the native counterpart to the dispatcher Heads-Up layer, focused on the
driver's next real constraint rather than fleet-wide analytics.

## Build

```text
applicationId  com.privatefleet.driver.nativeapp
versionCode    6
versionName    1.0.5
minSdk         26
targetSdk      36
JDK            Eclipse Adoptium 21
signing        PrivateFleet release key
```

Build command:

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
cd C:\privatefleet\apps\driver-native
.\gradlew.bat assembleRelease --no-daemon
```

Artifact:

```text
apps/driver-native/app/build/outputs/apk/release/app-release.apk
SHA-256 b103e0c188f536bcefdd7646804d3e78cbb35c34173340d69f758173ce2fc2bb
```

Signer certificate SHA-256:

```text
e6270febbb261e7225ae1405c22cb2e1bfacc6e01714716d605f9fc4a40304be
```

The same release certificate is used, so `adb install -r` preserves the
existing app data and remembered workspace/driver (the PIN is never stored).

## Release manifest

Published to:

```text
C:\PrivateFleet\downloads\native\app-release.apk
C:\PrivateFleet\downloads\native\latest.json
```

LAN download verified:

```text
https://api.privatefleet.home.arpa/downloads/native/latest.json  HTTP 200
```

Manifest:

```json
{
  "versionName": "1.0.5",
  "versionCode": 6,
  "sha256": "b103e0c188f536bcefdd7646804d3e78cbb35c34173340d69f758173ce2fc2bb",
  "apkUrl": "https://pf-node.tail060a86.ts.net/downloads/native/app-release.apk"
}
```

No BOM is present in the manifest.

## Verification

- `assembleRelease`: successful
- APK badging: versionCode 6, versionName 1.0.5
- `apksigner verify`: PrivateFleet certificate unchanged
- Emulator install: successful
- App launch: `MainActivity` resumed without a crash
- SHA-256 matches the published manifest
- Physical Phone 2 install: **pending; device not connected**

## Phone 2 blocker

At build time `adb devices` showed:

```text
RFCW10QT5ZE   device   SM-S901B   app 1.0.0   (older phone)
emulator-5554 device
R5CWB0BR3BP   not connected
```

I deliberately did not install onto `RFCW10QT5ZE`: it is not Phone 2 and is
still on 1.0.0.

Required before install:

1. Connect `R5CWB0BR3BP` by USB with USB debugging enabled.
2. Tap **Allow USB debugging** on the device.
3. Verify:

```powershell
adb devices -l
# expect R5CWB0BR3BP  device
```

Install command, to run once visible:

```powershell
adb -s R5CWB0BR3BP install -r C:\privatefleet\downloads\native\app-release.apk
adb -s R5CWB0BR3BP shell dumpsys package com.privatefleet.driver.nativeapp |
  Select-String "versionCode|versionName"
```

Then launch the app and confirm the remembered session still works. The
1.0.5 banner will appear only once the device has a pending stop with a window
inside the next 45 minutes or already overdue.

## Notes

- The update manifest still points at the Tailscale URL used by the native
  client. If the phone is on the LAN, ADB installation bypasses that download
  path; the app's API base remains the existing Tailscale endpoint.
- The 1.0.4 APK was retained locally as `app-release-1.0.4.apk`.
