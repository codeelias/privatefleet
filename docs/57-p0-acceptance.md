# 57 - P0 acceptance evidence (docs/56 frozen roadmap)

Status: in progress — recorded evidence per P0 item, never claimed ahead of proof.

## P0.1 Map pin tap-target identity hardening

- Change: pin visuals are byte-identical to before (36dp geometry and colours
  unchanged); the pin bitmap is composited at the exact centre of a 72dp
  transparent canvas, so its screen position is identical under any SDK anchor
  semantics while the touchable area gains 18dp padding on every side. The tap
  toast now includes the stop address (truncated) so the driver can verify the
  tapped stop is the intended one.
- Verified: JUnit suite passes (build 1.4.6, versionCode 38); installed on
  Phone 1; map renders correctly (logcat: `loadRoute fetched stops=4 points=1216`,
  signature `1Pp,2Pp,3Dp,4Dp` — the phone's true current plan).
- NOT YET VERIFIED: tap-identity on a DENSE route — the phone's current plan
  has 4 stops, so the dense-route mis-tap scenario is not live right now.
  Acceptance requires the driver tapping pins on a dense route and confirming
  the sheet/toast identity. Status: implemented, deployed, partially verified.

## P0.2 Second Android device validation

- NOT DONE. Phone 2 (`R5CWB0BR3BP`) was not connected to adb during this
  session. Required: install 1.4.6, offline capture + synchronisation test,
  confirm no duplicated records (server-side idempotency check).

## P0.3 Database backup restoration drill

- Executed on the production host: pg_dump (custom format) → restore into a
  fresh scratch database (`privatefleet_restore_drill`) → row-count integrity
  check against production frozen at the dump instant → evidence content-hash
  distinct-count check → scratch database dropped.
- Result: DRILL PASS.

```text
tenants            prod@dump=1        restored=1        OK
jobs               prod@dump=74       restored=74       OK
job_stops          prod@dump=146      restored=146      OK
routes             prod@dump=331      restored=331      OK
route_stops        prod@dump=3772     restored=3772     OK
location_points    prod@dump=64095    restored=64095    OK
stop_evidence      prod@dump=155      restored=155      OK
tracking_tokens    prod@dump=13       restored=13       OK
outbox             prod@dump=21892    restored=21892    OK
notifications      prod@dump=0        restored=0        OK
job_events         prod@dump=299      restored=299      OK
geofences          prod@dump=0        restored=0        OK
proof_policies     prod@dump=1        restored=1        OK
evidence hashes: prod=155 restored=155
```

Note: the first drill run showed a 2-row `location_points` difference caused
by live telemetry arriving between dump and count — measurement timing, not a
restore defect. The corrected run compares production frozen at the dump
instant and matches exactly.

## Acceptance gate status

```text
P0.1  implemented + deployed + partially verified  (dense-route tap test pending)
P0.2  blocked on device availability
P0.3  DRILL PASS
```

P1 (Commitment Recovery v1) is NOT authorised until the three P0 acceptance
results are recorded and reviewed.
