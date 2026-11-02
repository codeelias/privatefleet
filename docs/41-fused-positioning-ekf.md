# 41 - Fused positioning: raw GNSS quality + IMU EKF

Date: 2026-11-02  
Scope: native Android positioning and dispatcher quality visibility.

## Architecture

```text
Raw GNSS quality (1 Hz) ─┐
                         ├─ Ekf2D ─ 10 Hz fused fix ─ telemetry (1 Hz) ─ web map
IMU gyro/accel (50-100 Hz)┘
```

- `GnssQualityMonitor` reads `GnssStatus` and `GnssMeasurementsEvent`:
  satellites used in fix, L1/L5 frequency presence, and valid
  `ADR_STATE_VALID` carrier-phase accumulation.
- `FusedPositionEngine` registers `TYPE_ROTATION_VECTOR` and
  `TYPE_LINEAR_ACCELERATION` (or accelerometer minus gravity), requests GPS
  updates at 1 Hz, and predicts at 10 Hz.
- `Ekf2D` is a pure 2D constant-velocity filter (east, north, vEast, vNorth).
  Prediction integrates IMU acceleration with process noise; GNSS update uses
  the reported accuracy and the Joseph form to keep covariance symmetric.
- Stationary damping prevents IMU noise drift while parked.
- Output confidence is derived from EKF covariance and GNSS age:
  high / medium / low.

## What the app claims — and does not

The app can truthfully claim:

- fused GNSS + IMU positioning
- 10 Hz smoothed output between 1 Hz GNSS corrections
- raw-GNSS quality visibility (satellites, L1+L5, carrier-phase availability)
- an estimated error in metres from the filter covariance

It **does not claim sub-metre accuracy**. Sub-metre requires carrier-phase
positioning with corrections (RTK/PPP) and a correction source. This client
receives no corrections, so:

- carrier-phase availability is a quality signal, not a fixed solution
- no "RTK fixed" state is shown
- no centimetre guarantee is made

## Data contract

Telemetry samples now carry:

```text
source: gnss | fused | imu | network
satellitesUsed
dualFrequency
carrierPhase
ekfConfidence
```

`location_points` stores them via migration `0015_useful_riptide`; the fleet
snapshot exposes them on the vehicle so the dispatcher HUD can show:

```text
EKF fused fix · 18 satellites · L1+L5 · carrier phase · high confidence · 7 m estimated error
```

## Latency

- native fused fix: 10 Hz
- telemetry upload: at most 1 per 900 ms (within the existing 10-per-10 s API
  rate limit)
- web marker tween: reduced from 1.8 s to 0.95 s, so the pin follows the
  higher-rate feed instead of lagging behind it
- map camera remains 650 ms ease

## Tests

```text
native EKF JUnit tests: 4 passed
API telemetry quality test: passed
native release build: 1.0.6 / versionCode 7
APK signature: unchanged PrivateFleet release key
emulator install/launch: passed
```

## Stability corrections (1.0.9)

A field regression showed pins wandering and deviating unrealistically.
Root causes, all introduced with the fused engine:

1. `Ekf2D` propagated covariance with hand-derived cross-terms that were
   wrong for several off-diagonal entries. Incorrect covariance inflated the
   velocity gains, so noisy GNSS velocity bent the state between fixes.
   Replaced with a general `F P F^T` matrix product plus symmetrisation, and
   a unit test asserts the analytic values.
2. GNSS velocity (speed/bearing) was injected even when nearly stationary;
   stopped vehicles reported 0-1.5 m/s with random bearing, which the filter
   then integrated. Velocity is now fed only above 2 m/s and the initial
   state starts at rest below that threshold.
3. Dead reckoning ran indefinitely during GNSS outages, so IMU noise drifted
   the pin for minutes. Emission now stops after 15 s without a GNSS fix;
   the web treats the vehicle as stale instead of moving it.
4. Accelerometer gravity was seeded from zero, injecting a ~9.8 m/s^2 step;
   the low-pass is now seeded from the first reading, and IMU integration
   waits for a valid rotation matrix.
5. Telemetry cadence of 900 ms exceeded the 10-per-10 s API limit and hit
   429s; now 1050 ms.

## Honest gaps

- RTK correction transport exists (NTRIP client, 1.0.7) but no fixed solver is integrated; sub-metre is still not delivered.
- No raw pseudorange/carrier-phase position solver (RTKLIB/PPP) in the APK.
- IMU dead reckoning drifts during long GNSS outages; confidence drops and
  the UI says so.
- Device sensor quality varies; field validation against a surveyed reference
  is still required.
- 10 Hz uploads are intentionally throttled to 1 Hz to respect the telemetry
  rate limit and battery budget.
- Physical Phone 2 install of 1.0.6 remains pending; the phone was not
  connected during the build.
