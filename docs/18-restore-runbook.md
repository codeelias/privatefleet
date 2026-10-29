# Restore runbook — database, geometry and evidence

## Backup artifacts

`scripts/backup.ps1` writes a timestamped pair:

```text
privatefleet-<stamp>.dump.age
privatefleet-<stamp>.evidence.tar.age
```

plus SHA-256 checksum files. Keep the age private key off the application host
and outside both archives. Mount it only on a controlled restore workstation.

## Restore

1. Verify both `.sha256` files.
2. Decrypt on the restore workstation:

   ```powershell
   age -d -i <offline-key> -o restore.dump privatefleet-<stamp>.dump.age
   age -d -i <offline-key> -o evidence.tar privatefleet-<stamp>.evidence.tar.age
   ```

3. Create an isolated database and PostGIS extension.
4. Restore with parallel jobs. `--jobs` is only valid for custom-format
   archives and cannot be combined with `--single-transaction`:

   ```powershell
   pg_restore -h 127.0.0.1 -U postgres -d privatefleet_restore `
     --no-owner --exit-on-error --jobs=4 restore.dump
   ```

5. Extract media and compare every `stop_evidence.storage_key` file with its
   stored SHA-256 `content_hash`.
6. Check runtime-role RLS: own-tenant evidence visible, foreign evidence zero.
7. Drop the isolated database after verification.

`scripts/restore-drill.ps1` implements the same procedure with a fresh dump and
records counts, hash matches and RTO.

## Verified result

Full geometry-inclusive restore on 2026-10-29:

```text
PG_RESTORE_JOBS=4
PG_RESTORE_EXIT=0
RESTORE_SECONDS=242.8
TOTAL_RTO_SECONDS=474.9
EVIDENCE_HASH_MATCHED=2 HASH_FAILED=0
RUNTIME_OWN_EVIDENCE=2 RUNTIME_FOREIGN_EVIDENCE=0
jobs=878
routes=21462
route_stops=228720
location_points=30539
job_stops_geom=987
evidence=2
RESTORE_ERROR_LINES=0
```

This proves the post-decryption restore and geometry path. Decryption of the
actual encrypted production archive remains **NOT VERIFIED** until the offline
age private key is supplied; the key was deliberately absent from the host.
