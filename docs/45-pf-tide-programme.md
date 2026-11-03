# 45 - PF-TIDE: staged positioning programme (Stage 0-1)

Date: 2026-11-03  
Status: Stage 0 complete; Stage 1 shadow estimator built and unit-tested;
**zero production influence** (nothing is wired to the live path).

## Architecture (server-authoritative)

```text
Android phones  → observations (unchanged provider flow + StationaryGate)
Fastify         → PF-TIDE Core: event-time replay, adaptive R, NIS gating,
                  motion modes, corrected + predicted state, bounded horizon
React/MapLibre  → presentation only (later stage)
```

Permanent rules adopted: never mutate the original measurement; presentation
never feeds the estimator; road centreline is a constraint, not truth;
predictions grow uncertainty and expire; surprising observations are
investigated, not silently dropped; confidence is calibrated or unpublished.

## Stage 0 - baseline (measured)

Source: every `location_points` row from the last 24 h (28,123 observations).

```text
Tom (39af5bb5): n=15793 medianDisp=0.7m p95Disp=26.9m
                medianAcc=17.5m sourceChanges=8 stationarySpread=674.9m
Mo  (890e2d51): n=12330 medianDisp=1.0m p95Disp=39.5m
                medianAcc=22.1m sourceChanges=15 stationarySpread=69.9m
```

Notes: the window includes the discarded fused-engine era, so spread and p95
are inflated by historical churn; fresh runs will be cleaner. Median age ≈ 0 s
(the -0.3 s is clock skew between device and server).

## Stage 1 - PF-TIDE Core shadow (built, not wired)

`apps/api/src/modules/positioning/`:

- `pf-tide.ts` — pure estimator:
  - event-time replay buffer (60 s, 240 entries) with fixed-lag recomputation
  - adaptive R from reported accuracy, satellite count, source, movement state
  - NIS innovation gate (warn 5.99 / reject 9.21, calibrated starting points)
  - STOPPED / STRAIGHT / UNKNOWN modes with zero-velocity updates
  - corrected vs current-time predicted state, bounded 30 s horizon, `validUntil`
  - FRESH / DEGRADED / COASTING status
- `baseline.ts` — Category A metrics (median/p95 displacement, accuracy, age,
  source changes, stationary spread)
- `pf-tide.test.ts` — 6 tests: stationary hold, NIS reject, network inflation,
  out-of-order replay, prediction growth, honest coasting
- `scripts/baseline-cli.ts` — replay metrics from an exported CSV

## Next stages (gated)

- Stage 2: run the shadow over ingested telemetry in parallel, expose a
  diagnostic endpoint, compare against the baseline on identical observations.
- Stage 3: route-relative constraint along the planned OSRM route (separate
  `snapped_position`), HMM interface reserved.
- Stage 4: swap web presentation to the snapshot only after Category A wins.

## Validation path (open-source, no payment)

- Category A: stability/consistency/latency from stored observations + pf-diag.
- Category B: PPK post-processing with RTKLIB against free OS Net RINEX, once
  field logs exist. Own base (u-blox F9P + RTKLIB str2str) is the long-term
  correction option; no commercial dependency adopted.

## Files

```text
apps/api/src/modules/positioning/pf-tide.ts
apps/api/src/modules/positioning/baseline.ts
apps/api/src/modules/positioning/pf-tide.test.ts
apps/api/scripts/baseline-cli.ts
```
