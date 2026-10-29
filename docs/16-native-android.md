# Native Android pilot â€” configuration and gate

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

