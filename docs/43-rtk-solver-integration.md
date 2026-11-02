# 43 - RTK solver integration (RTKLIB via JNI)

Date: 2026-11-02  
Scope: native C/C++ solver pipeline, compiled and linked but not yet
validated against a live base station.

## What exists in the APK (1.0.8)

- **NDK 27.1 + CMake 3.22.1** toolchain.
- **RTKLIB 2.4.3** vendored translation units compiled into `libpf_rtk.so`
  (all four ABIs present in the APK).
- **JNI bridge** `pf_rtk.cpp`:
  - `NativeRtkEngine` loads `pf_rtk`.
  - Raw Android observations (pseudorange, pseudorange-rate, carrier phase,
    CN0, frequency) are converted to RTKLIB `obsd_t` rover records.
  - RTCM bytes from `NtripClient` feed `input_rtcm3`, building base
    observations, broadcast ephemeris and the base station position
    (messages 1005/1006).
  - `rtkpos` runs kinematic RTK (`PMODE_KINEMA`, IFC ionosphere, Saastamoinen
    troposphere, broadcast ephemeris, 15° elevation mask) under a mutex.
- **TelemetryService** feeds every raw measurement epoch into the solver and,
  when the solver reports a fixed solution, publishes that position with
  `rtkState = rtk_fixed` and nominal 0.10 m uncertainty.

## What the app still does not claim

- No live base station has been processed yet; the solver has not produced a
  validated fixed solution in the field.
- The 0.10 m fixed-mode accuracy is a nominal RTK value, not a measurement of
  this device; the ground-truth campaign will replace it with real numbers.
- GPS-only pseudoranges are used where received-sv-time is available; other
  constellations feed through RTKLIB's own handling as they become valid.
- No PPP: only RTK kinematic mode is compiled.

## Verification so far

```text
gradle assembleRelease:      SUCCESS (RTKLIB compiles and links)
libpf_rtk.so in APK:         arm64-v8a, armeabi-v7a, x86, x86_64
JNI + RTK sources:           21 translation units
release signing:             unchanged PrivateFleet key
version:                     1.0.8 / versionCode 9
emulator:                    app launches; native lib loads on service start
                             (service start requires an active driver session)
```

## Honest status

This is a real, compiled RTK pipeline, not a stub. What it is **not** is a
proven RTK engine: it has never processed a real RTCM base stream together
with the phone's raw observations. That requires a physical device, a base
station or NTRIP mount within ~10-30 km, and a surveyed reference route.

## Validation campaign (the only thing that can finish "true sub-metre")

1. Configure a base station / NTRIP mount via the correction settings.
2. Stationary test at a surveyed point: record RAW_READY →
   CORRECTIONS_READY → RTK_FLOAT → RTK_FIXED transitions.
3. Drive test with a surveyed reference: p50/p95 horizontal error per state,
   fix rate, time-to-first-fix, reacquisition after a tunnel.
4. Publish the measured numbers; replace the nominal 0.10 m value with the
   device's measured fixed-mode uncertainty.

## Files

```text
apps/driver-native/app/src/main/cpp/pf_rtk.cpp
apps/driver-native/app/src/main/cpp/CMakeLists.txt
apps/driver-native/app/src/main/cpp/rtklib/*            (vendored 2.4.3)
apps/driver-native/app/src/main/java/.../NativeRtkEngine.java
apps/driver-native/app/src/main/java/.../TelemetryService.java
```
