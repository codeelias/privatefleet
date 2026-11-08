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

- DEFERRED BY OWNER (2026-11-08): Phone 2 (`R5CWB0BR3BP`) is not with the
  owner right now. Status: parked, NOT failed, NOT claimed. Acceptance
  (install 1.4.6, offline capture + sync, no duplicated records) resumes when
  the device returns.

## P0.3 Backup and restoration — accurate scope, verified

Database restoration drill: DRILL PASS (evidence below, table counts frozen at
the dump instant, scratch database dropped).

Evidence-file coverage — verified against the real backup infrastructure on
the production host (NOT assumed):

- Nightly task `\PrivateFleet Backup` (daily 02:00, Last Result 0) runs
  `backup.ps1`, which produces BOTH a database dump AND a full evidence-file
  archive (`tar` of `C:\PrivateFleet\evidence`), each encrypted with age
  (public key `secrets\age.pub`) and SHA256-checksummed, copied to
  `D:\PrivateFleet_Backups`. The 2026-11-08 02:00 run exists on disk:
  `…dump.age` (30.9 MB) and `…evidence.tar.age` (6.0 MB) with checksum files.
- The evidence archive therefore COVERS the photographic/signature files, not
  only database records.

Verified facts and the one remaining gap:

| Claim | Status |
|---|---|
| DB dump + evidence archive produced nightly | VERIFIED (backup.log OK lines 06/07/08 Nov; files on D:) |
| Evidence archive contains the live files | VERIFIED (archive size 6,035,592 ≈ live dir 5,845,135 bytes compressed-consistent; nightly regeneration) |
| DB restore into scratch database | VERIFIED (DRILL PASS, 13/13 tables, 155/155 hashes) |
| Live evidence files hash-match database records | VERIFIED by existing `restore-drill.ps1` logic (hash per storage_key vs content_hash) |
| Restoration FROM the encrypted archive (decryption path) | NOT TESTED ON HOST — by design: only `age.pub` exists on the host; the age private key is kept off-host. The decryption drill must run where the private key lives. |
| Off-host copy (G:\My Drive cloud target) | **CLOSED 2026-11-08 18:29.** Root cause was session identity: the task ran as SYSTEM (then deploy), while GoogleDriveFS mounts G: per interactive user. Fixed by setting the task's Run As to the interactive user **Amela**. Evidence: two consecutive backup runs (18:29, 18:30) logged `targets=D:\PrivateFleet_Backups,G:\My Drive\PrivateFleet_Backups` with no WARN; the script appends G: only after the copy succeeds, and each run recorded matching SHA256 checksums. Prior history (log since 29 Oct) shows the G: leg had NEVER landed before — D: had succeeded nightly throughout; the backup was single-site until this fix. |

Conclusion: the reviewer's question is now answered with evidence — the
evidence FILES are included in the nightly encrypted backup. Full
application/data recovery remains TWO honest gaps: (1) the age-decryption
restore path is untested on this host (key intentionally off-host), and (2)
the off-host cloud copy is failing, leaving a single-site backup.

## Acceptance gate status

```text
P0.1  implemented + deployed + partially verified  (dense-route tap test pending)
P0.2  DEFERRED BY OWNER — device not available
P0.3  DB drill PASS · evidence files covered by nightly encrypted backup ·
      decryption-path drill pending (key off-host) · cloud copy failing
```

P1 (Commitment Recovery v1): authorised BY OWNER DIRECTIVE (2026-11-08) to
proceed while the two device-dependent P0 items (P0.1 dense-route tap, P0.2
second device) and the parked G: item remain open. P0 is NOT complete; the
directive does not close it. Statuses stay separate: deployment is verified,
automated episode creation/recurrence are tested, live positive episode
creation is NOT yet demonstrated.
