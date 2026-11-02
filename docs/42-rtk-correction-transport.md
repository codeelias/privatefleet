# 42 - RTK correction transport and precision gate

Date: 2026-11-02  
Scope: the true sub-metre path, implemented up to the solver boundary.

## What is real now

### Native 1.0.7

- `NtripClient`: an NTRIP 2.0 client that streams RTCM from a caster.
  - Basic auth header
  - RTCM3 framing (0xD3, 12-bit length)
  - tracks connection, last-message age and message types
  - reconnect loop with backoff
- `CorrectionsConfig`: endpoint, mountpoint and credentials stored in local
  preferences; no secrets in the APK source.
- `PrecisionState`: the only place precision states are decided.

```text
UNSUPPORTED -> RAW_READY -> CORRECTIONS_READY -> RTK_FLOAT -> RTK_FIXED
```

- `RtkSolver` is the solver boundary. The shipped implementation is
  `NoRtkSolver`, which can never report float or fixed. The state machine
  therefore reaches at most `CORRECTIONS_READY` today.
- `TelemetryService` reports `rtkState` and `correctionAgeMs` with every fused
  sample. Corrections are disabled by default until configured.

### API / dispatcher

- Telemetry and vehicle contracts carry `rtkState` and `correctionAgeMs`.
- `location_points` stores them (migration `0016_freezing_bushwacker`).
- The dispatcher HUD shows:

```text
Precision: Corrections ready · corrections 0.8 s old
```

## What is deliberately not claimed

- No RTK fixed or float solution exists in the APK.
- No NDK/CMake toolchain or RTKLIB build is present.
- Carrier-phase availability plus corrections is a readiness signal, not a
  position guarantee.
- `rtk_fixed` can only appear after a validated ambiguity-fixed solver
  produces one.

## Tests

```text
NtripClient JUnit:       auth header, RTCM3 length decode (passed)
PrecisionState JUnit:    unsupported/raw/corrections/float/fixed ordering (passed)
API telemetry test:      rtkState + correctionAgeMs round-trip (passed)
native release build:    1.0.7 / versionCode 8 (passed)
```

## Next to reach RTK_FIXED

Implemented in 1.0.8 and documented in
[`docs/43-rtk-solver-integration.md`](43-rtk-solver-integration.md):

1. ~~Install the NDK + CMake toolchain.~~
2. ~~Vendor RTKLIB (BSD) or a commercial RTK engine.~~
3. ~~Bridge Android raw measurements (GnssMeasurement) into RTKLIB observation
   data; feed RTCM corrections from `NtripClient`.~~
4. ~~Only report float/fixed through `RtkSolver` once the solver produces them.~~

Remaining:

5. Add a corrections screen for endpoint/mountpoint management.
6. Ground-truth validation:
   - surveyed reference points
   - stationary 20-minute and drive tests
   - p50/p95 horizontal error per state (RAW_READY, CORRECTIONS_READY, FIXED)
   - publish numbers, do not estimate them

## Ground-truth harness plan

The client already logs raw quality and fused output; the harness adds
reference truth:

```text
device under test -> raw GNSS + corrections + fused fixes (CSV)
surveyed reference -> position per timestamp
compare -> CDF of horizontal error, age, fix states
```

The harness cannot run without a physical device and a surveyed route; that is
a field activity, not code.
