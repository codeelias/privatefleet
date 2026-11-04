# 49 - Product-quality programme log

Date: 2026-11-04
Objective: make every feature industry-standard - lightweight, fast, reliable,
performant and appealing. Each slice: scope → change → tests → build →
production smoke → separate commit → recorded metric.

## Engineering discipline rules (adopted for this programme)

1. One change-set per slice; commit messages state the slice.
2. Typecheck + unit tests + build before any deploy (scripts/verify.ps1).
3. Production smoke check after every deploy; no unverified claims.
4. Before/after metrics recorded for every performance change.
5. Physical-device verification is recorded as pending when a device is not
   connected - never claimed as done.

## Slice log

### S1 - Web performance: split map engines from the shell (done)

- Change: React.lazy for MapCanvas/GeofenceEditor/TrackingHub and the
  customer-facing PublicTracking/CustomerPortal; vendor manualChunks;
  hoistTransitiveImports off.
- Metric: login bundle 1.78 MB raw / ~500 KB gzip → 104 KB gzip index +
  8 KB vendors ≈ 111 KB gzip; MapLibre 253 KB / Leaflet 25 KB load lazily.
- Verified: production network trace (login loads 2 JS files; map canvas
  renders after sign-in); unit 53; E2E map 5/5.
- Commit: `4a08df9`.

### S2 - Web UX: states and leaks (done)

- Change: professional connection banner, initial loading skeleton, real
  customer-preview link, real domain label.
- Verified: full-screen walkthrough (6 screens) with zero console errors and
  zero demo-string leaks; live /track/<token> popup works.
- Commits: `396d247`, `96b95fd`.

### S3 - Native polish: driver queue states (built, device install pending)

- Change: persistent "Offline - could not load your jobs" state with retry,
  loading indicator, refresh disabled while busy, auto-retry on reconnect
  (ConnectivityManager default-network callback).
- Build: 1.0.15 / versionCode 16, JUnit 16/16, emulator launch clean.
- Verified: emulator install + launch; physical-phone behaviour pending
  reconnection (RFCW10QT5ZE / R5CWB0BR3BP not attached).

## Open slices

- S4 - Native polish (remaining): status-line freshness, button busy states
  for arrive/complete/sign, offline evidence banner.
- S5 - Reliability verification: socket reconnection, outbox retry, API
  error sweep with evidence.
- S6 - Discipline: promote scripts/verify.ps1 to a CI runner (host-side).

## Reference metrics

```text
API healthz:      p50 ~47 ms (LAN, 10 samples)
Native APK:       1.1 MB (all four ABIs incl. RTKLIB)
Web login shell:  111 KB gzip
```
