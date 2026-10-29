# Native Android pilot Ã¢â‚¬â€ configuration and gate

## Status

Stage A is **not passed**. The workstation has JDK 21, Android SDK platforms
33/34/36, build tools and `adb`, but no physical Android device is connected
and no AVD exists. A prebuild attempt failed while fetching the Expo Android
template due to a network fetch failure, so no native project was generated. No
native build has been run. Stage B/C are therefore **NOT VERIFIED**.

## API origin

Native builds use:

```text
https://api.privatefleet.home.arpa
```

The web app uses `https://app.privatefleet.home.arpa`; they are separate Caddy
sites. The Expo native default is set in `apps/driver-expo/src/api.ts`, and can
be overridden at build time with:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://api.privatefleet.home.arpa"
```

The native app must never use the driver HTTP test origin `http://192.168.1.128:8080`.

## Android CA / DNS

The phone must resolve `api.privatefleet.home.arpa` to the LAN host and trust
the Caddy internal CA. For the development build, install the Caddy root CA as
a user certificate, then use:

```powershell
npx expo run:android --device
```

`apps/driver-expo/plugins/withDebugNetworkSecurityConfig.js` generates a
debug-only `network_security_config.xml` that trusts user-installed CAs and
overlays it in `app/src/debug/AndroidManifest.xml`. Release builds retain the
platform trust store. The plugin is registered in `apps/driver-expo/app.json`.

The user CA is trusted only for debuggable builds; it must not be added to
release network security configuration.

## Acceptance gate (after a device is connected)

1. Build/install the debug app and verify `GET /healthz` over validated HTTPS.
2. Camera capture and signature rendering; complete a job with required proof.
3. Structured failed delivery and dispatcher alert.
4. Network loss during evidence upload.
5. Terminate and reopen the app with pending evidence.
6. Restore connectivity; exactly-once server effects and evidence hashes.
7. A 4xx conflict preserves local media and is visible to the driver.

Background location is a separate gate after POD/offline acceptance. Android
does not relaunch a force-stopped app automatically, so no uninterrupted
tracking promise is made.
## Emulator acceptance — Stage B PASS (emulator only)

Built and installed the debug APK on a local Android 16 (API 36) emulator
(`sdk_gphone64_x86_64`, AVD `PrivateFleet`) on 2026-10-29.

Build fixes required:

- The first prebuild failure was a transient Expo template fetch failure; a
  retry succeeded with no SDK upgrade.
- Disk headroom was insufficient for Gradle + emulator userdata; caches and
  unnecessary SDK components were removed.
- Expo SDK 53 autolinking generated
  `import expo.core.ExpoModulesPackage` while the native class is
  `expo.modules.ExpoModulesPackage`. The config plugin now injects a Gradle
  task that normalizes this generated import after autolinking. This workaround
  is debug-build only and does not change the Expo SDK.

Emulator network path:

- API origin was `https://api.privatefleet.home.arpa`; TLS validation remained
  enabled.
- The emulator used a host CONNECT proxy to resolve the LAN-only hostname.
- The debug-only network security config trusted the Caddy CA from
  `PF_DEBUG_CA_CERT` for this emulator build, plus user CAs. Release builds do
  not include this bundled CA.
- Metro HTTP was explicitly permitted only for `10.0.2.2`, `localhost` and
  `127.0.0.1`; the API remained HTTPS-only.

Observed on the emulator:

- Driver PIN login over HTTPS succeeded.
- Native signature pad captured a 145-character path.
- Native camera opened, captured and accepted a photo (24,090 bytes uploaded).
- Completion uploaded signature + photo before transitioning the stop.
- API evidence retrieval returned both media with SHA-256 hashes.
- With the API host forced down, the completion stayed pending; force-closing
  and reopening the app showed `1 action(s) waiting to sync` and the local
  signature survived.
- After restoring connectivity and restarting, the pending operation uploaded
  the signature and completed exactly once.
- A completion with a missing required recipient produced a 4xx conflict:
  queue status `conflict`, signature preserved locally, stop remained
  `arrived`, and the UI showed `1 action(s) need attention`.

Server-side exactly-once check:

```text
completed_events=1
evidence_signature=1
evidence_photo=1
j196_first=completed
j202_first=arrived
```

Physical-device acceptance is still **NOT VERIFIED**. The emulator proves the
native JS/native-module/file-queue path, but not a physical camera, Android
process-kill behaviour on retail hardware, or iOS.

