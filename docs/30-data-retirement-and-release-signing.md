# 30 - Data retirement and native release signing

Date: 2026-11-01  
Baseline: `af5549e` + release signing changes  
Environment: production host `192.168.1.128`, synthetic data.

---

## 1. Load tenant retirement

### Why

`load-8d0a3a98` (Load Smoke Co) held:

```text
866 jobs
21,240 routes
90 published routes
21,150 superseded routes
```

It was isolated by RLS, but it polluted global route-version history and demo
baselines. It was synthetic load data, not a customer.

### Safety

1. Full PostgreSQL custom-format backup before deletion:

```text
C:\PrivateFleet\backups\pre-retire-load-20261101-230125.dump
size: 773,152,927 bytes
```

2. Deletion ran in a single transaction with `ON_ERROR_STOP=1`.
3. Post-delete verification:

```text
tenant                    jobs   routes
northstar-couriers-...     74      325

routes: published 2, in_progress 1, superseded 321, cancelled 1
```

4. The two published routes and one in-progress route belong to Northstar and
   were not touched.

### Recovery

The dump is a complete pre-deletion database. Restore only to a staging
database first; see `docs/18-restore-runbook.md`.

The executable procedure is `scripts/retire-load-tenant.ps1`. It is guarded by
the explicit slug and aborts if the backup is missing or too small.

---

## 2. Native release signing

### Key material

```text
Keystore:   C:\privatefleet\secrets\privatefleet-release.jks
Alias:      privatefleet
Algorithm:  RSA 4096, SHA384withRSA
Validity:   10,000 days
Build props: apps/driver-native/keystore.properties (gitignored)
```

The keystore password is generated randomly and is **not** in git. The
`secrets/` directory, `keystore.properties`, `*.jks` and `*.keystore` are
gitignored.

### Build configuration

`apps/driver-native/app/build.gradle` reads `keystore.properties` from the
native project root and applies it to the `release` build type. If the file is
absent, debug builds still work; a release build is then unsigned and must not
be distributed.

Version for this build:

```text
versionCode 4
versionName 1.0.3
```

### Verified certificate

```text
Signer #1 DN: CN=PrivateFleet, OU=Pilot, O=PrivateFleet, L=London, C=GB
SHA-256: e6270febbb261e7225ae1405c22cb2e1bfacc6e01714716d605f9fc4a40304be
SHA-1:   68c2753d3c33f7b576d781f1c7ec7c573149b6d0
```

`apksigner verify --print-certs` passed. The release APK launches on the API 36
emulator; the physical pilot phone still runs the debug build so its data is
not wiped during this step.

### Build

```powershell
cd apps/driver-native
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

### Install

A debug-signed install cannot be upgraded to release signing. The first release
install requires uninstalling the debug package, which clears its local session
and queue:

```powershell
adb uninstall com.privatefleet.driver.nativeapp
adb install -r app/build/outputs/apk/release/app-release.apk
```

### Operational rule

- Back up the keystore and password separately from the host.
- Never regenerate the key for an existing application ID; Android will reject
  the update.
- Never commit the keystore or `keystore.properties`.
- Every release must increment `versionCode`.

---

## 3. Current state

| Item | State |
|---|---|
| Load tenant removed | Complete, backup retained |
| Northstar data untouched | Verified |
| Release signing config | Complete |
| Signed APK produced | Complete |
| Certificate verified | Complete |
| Physical-phone release install | Complete on R5CWB0BR3BP, logged in as Mo Khan |
| Update channel | Not yet defined |
