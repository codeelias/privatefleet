# 44 - Stationary-aware location engine and diagnostics

Date: 2026-11-03  
Scope: standard-GPS stability, measured first. No Kalman, no RTK changes.

## Problem

Field testing showed the marker drifting and dancing while vehicles were
parked. The fused EKF was removed in 1.0.11; this round adds the stationary
handling the dispatcher actually needs, without inventing accuracy.

## Pipeline (native 1.0.12)

```text
GPS 10 s + network 15 s (raw fixes)
  → quality gate (accuracy ≤150 m, fix age ≤60 s, out-of-order wall clock)
  → source arbitration (network ignored while a GPS fix is <45 s old)
  → StationaryGate (movement classifier + position hold)
  → telemetry (position, accuracy, movementState, capturedAt)
```

- `StationaryGate` is pure, unit-tested logic with hysteresis:
  - STATIONARY after 2 still votes (speed ≤1 m/s and displacement ≤ max(acc,10 m))
  - MOVING after 2 moving votes (speed ≥2.5 m/s or displacement > max(2·acc,25 m))
  - while STATIONARY the displayed position is the triggering real fix —
    later GPS scatter does not move the pin
  - the hold refines only toward clearly better fixes (<15 m and <0.8× accuracy)
  - freshness is preserved: every accepted fix updates `capturedAt`, so
    STATIONARY ≠ STALE
- Per-fix diagnostics (`pf-diag` logcat) record provider, accuracy, age,
  wall-clock and elapsed-realtime timestamps, speed + speed accuracy,
  bearing + bearing accuracy, displacement, decision and movement state —
  without changing the position behaviour.

## Contracts

- Telemetry samples and vehicle snapshots now carry `movementState`
  (unknown/stationary/moving); `location_points.movement_state` via
  migration `0017_harsh_lizard`.
- Dispatcher HUD shows "Parked — position held" / "Moving" / "Movement
  unknown" and draws an accuracy ring around the selected vehicle whose
  radius is the reported accuracy at the current zoom.

## Acceptance criteria (to be proven in the field)

1. Parked phone: displayed position settles and does not dance.
2. Moving phone: marker follows without excessive delay (hysteresis ≤ 2 fixes).
3. Accuracy remains the device-reported value; the ring shows uncertainty.

## Tests

```text
StationaryGate JUnit: 4 passed (hold, release, jump, displacement)
API telemetry test:   movementState round-trip (passed)
native build:         1.0.12 / versionCode 13
```

## Files

```text
apps/driver-native/.../StationaryGate.java, StationaryGateTest.java
apps/driver-native/.../TelemetryService.java
packages/contracts/src/api.ts, domain.ts, events.ts
apps/api/src/db/schema.ts, drizzle/0017_harsh_lizard.sql
apps/api/src/modules/tracking/service.ts, telemetry.test.ts
apps/api/src/modules/fleet/pg-service.ts
apps/web/src/features/live-map/MapCanvas.tsx
```
