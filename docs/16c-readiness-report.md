# Production Readiness Report - Pilot Gate

Date: 2026-10-28
Baseline: `7b5112e` (fleet dispatcher UI)
Environment: local API + PostgreSQL 16/PostGIS 3.4.2; OSRM 5.25.0 and VROOM
1.13.0 on Docker host `192.168.1.128` (ports 5000/3000, LAN-only); synthetic
tenants only.

This report separates **code-level evidence** from **operational facts** that
still require the deployment host, firewall, backup environment or a business
decision. Nothing here is a substitute for the pilot contract review.

## Gate summary

| Gate | Status | Evidence |
|---|---|---|
| Tenant isolation (RLS) | **PASS** | Automated probe as runtime role `privatefleet_app`: 16/16 tenant tables have RLS + policy; cross-tenant SELECT/UPDATE/DELETE affect 0 rows; foreign INSERT rejected; same checks pass on the restored database |
| Authentication lifecycle | **PASS (core)** | Access TTL default 900 s; rotating refresh tokens with replay rejection and revocation tests; argon2id hashes; minimum JWT secret raised to 32 chars |
| Auth abuse resistance | **PASS (single-instance, shared-IP behaviour documented and tested)** | Dual-key sliding-window limiter on staff login and driver PIN: 5 failures/account/minute and 50 failures/IP/minute; `429 AUTH_RATE_LIMITED` with `Retry-After`; no permanent lockout. Account isolation and the deliberate IP-aggregate cut-off are both integration-tested. In-memory, single-instance only |
| Telemetry rate limiting | **PASS (single instance)** | 10 batches / 10 s per driver, 429 `TELEMETRY_RATE_LIMITED` covered by tests; limiter is in-memory and **not shared across API instances** |
| Request hardening | **PASS (code)** | 256 KiB body limit, bounded fleet `driverIds` (max 100), nosniff/frame/referrer headers, explicit CORS origins; no TLS/WAF verified here |
| Dependency audit | **PASS (runtime) / OPEN (build tooling)** | Zod upgraded 3.25.76 -> 4.6.6 (advisory resolved; API/contracts/web typecheck and tests pass). Remaining 9 advisories (5 high, 3 moderate, 1 low) are all under the Expo/Metro build toolchain, not the API runtime; see disposition |
| Network exposure | **PARTIAL** | OSRM/VROOM reachable over LAN and used directly; public-internet exposure **not verified** (operator firewall/VPN decision) |
| Backup/restore drill | **PASS (drill)** | Separate database restore, identical counts/checksums, app-role isolation verified; no automated backup/PITR yet |
| Migration/extension recovery | **PASS (verify)** | Restored database has 7 migrations, PostGIS 3.4.2, 16 RLS tables/policies |
| Cache integrity | **PASS** | `resultSchemaVersion=2` in cache identity; cached results validated before return; corrupted cache rejected with `ROUTING_INVALID_RESPONSE` |
| Load smoke 50 vehicles / 500 jobs | **PASS** | 3.15 s total; matrix 237 ms (89 locations), solve 651 ms, geometry 1.56 s; 45 routes, 0 unassigned |
| Load smoke 100 vehicles / 850 jobs | **PASS** | 6.34 s total; matrix 226 ms (89 locations), solve 2.12 s, geometry 2.46 s; 90 routes, 0 unassigned |
| Load smoke 100 vehicles / 1,000 jobs | **GUARDED REJECTION** | 1,126 solver tasks > 1,000 limit; rejected in 1.86 s with `PLAN_TOO_LARGE` before external calls; not a pass for a single batch |
| Publication atomicity/outage | **PASS** | Existing fleet tests + real gate: 26 persisted stops, 2 service identities, assignments match; outage preservation unchanged |
| Dispatcher fleet UI | **PASS** | Auth E2E 11/11 (fleet review, unassigned reasons, atomic approval, stale handling) |
| Demo baseline | **PASS** | Demo E2E 13 passed, 13 skipped (intentional) |

## 1. Tenant isolation and security

Automated probe (`apps/api/src/db/rls.test.ts`, part of the API suite):

- Runtime connection asserts `current_user = privatefleet_app` (non-owner).
- Inventory: all 16 tenant-owned tables (`users`, `vehicles`, `drivers`,
  `jobs`, `job_stops`, `job_events`, `alerts`, `outbox`, `refresh_tokens`,
  `idempotency_keys`, `demo_scenarios`, `location_points`, `routes`,
  `route_stops`, `optimization_runs`, plus `tenants` with id-based policy)
  have RLS enabled and a policy.
- For every table, tenant A cannot see, update or delete tenant B rows;
  B's data survives attempts; foreign-tenant INSERT is rejected by WITH CHECK.
- Tenant context is set server-side via `set_config('app.tenant_id', ..., true)`
  inside authenticated requests; client-supplied tenant ids are not trusted.
- The same structural and app-role isolation checks were repeated on the
  restored database (foreign jobs visible/updated: 0).

Authentication:

- Access tokens are short-lived (900 s default, configurable); refresh tokens
  rotate with replay rejection; logout/revocation paths covered by API and
  browser tests.
- JWT secret now requires at least 32 characters in production configuration.
- **Throttling implemented:** staff login and driver PIN verification use a
  dual-key sliding-window limiter (account/device + source IP). Defaults: 5
  failures per account per 60 s, 50 failures per IP per 60 s, then
  `429 AUTH_RATE_LIMITED` with `Retry-After`. There is **no permanent
  lockout**: the window expires and the legitimate user can retry. A success
  clears only that account bucket, never the shared IP bucket; shared-IP
  (depot WiFi) users are independent. State is bounded (10,000 buckets, LRU
  eviction) and process-local; multi-instance deployments need a shared
  limiter or sticky routing. Reverse-proxy trust is not configured, so
  `request.ip` is the socket address; set `trustProxy` only for a trusted
  proxy before relying on forwarded IPs.
- **Shared-IP trade-off (tested, intentional):** exhausting Account A's
  five-failure bucket does **not** block Account B at the same depot IP;
  B authenticates successfully while the IP aggregate is below 50. Once the
  IP aggregate reaches 50 failures within the window, **every** account behind
  that IP is throttled with `429 AUTH_RATE_LIMITED` and `Retry-After` until
  the window expires. This is a deliberate anti-spray trade-off for shared
  egress addresses, not an account-isolation bug; operators must understand
  that a hostile device on a depot NAT can briefly affect colleagues.

Request hardening added: explicit 256 KiB body limit, max 100 driver ids per
fleet subset, nosniff/frame/referrer headers, explicit CORS origin allowlist.
TLS/reverse proxy is not configured or verified in this environment.

Dependency audit: Zod was 3.25.76, inside the advisory range; it is now
resolved to **4.6.6** via the workspace override, with all API/contracts/web
typechecks and suites passing. `pnpm audit --prod` now reports **9**
advisories: 5 high (PostCSS file read/path traversal x2, image-size DoS x2,
node-forge signature verification), 3 moderate (PostCSS x2, uuid bounds) and
1 low (deepmerge). Every reported path is under `apps/driver-expo`'s Expo/
Metro/CLI build toolchain; none resolve into the API runtime or deployed
server bundle. They remain build-machine exposure and require an Expo/Metro
upgrade path; do not describe the dependency surface as clean.

## 2. Backup/restore drill (non-destructive)

Executed against the dev database; source untouched; temporary restore DB
dropped after verification.

Commands (passwords redacted):

```bash
# create isolated target owned by the migration role
runuser -u postgres -- psql -c "CREATE DATABASE privatefleet_restore_test OWNER privatefleet;"
runuser -u postgres -- psql -d privatefleet_restore_test -c "CREATE EXTENSION IF NOT EXISTS postgis;"
# consistent custom-format backup
pg_dump -h 127.0.0.1 -U privatefleet -d privatefleet_dev -Fc -f /tmp/privatefleet_drill.dump
# restore (superuser restore, ownership normalised with --no-owner; grants retained)
runuser -u postgres -- pg_restore -d privatefleet_restore_test --no-owner /tmp/privatefleet_drill.dump
```

Observed: dump **437 ms**, restore **679 ms**, archive **314,322 bytes**.
Verification (source vs restore): identical counts for tenants (45), users
(45), vehicles (21), drivers (21), jobs (83), job_stops (156), alerts (6),
outbox (291), refresh_tokens (1,052), idempotency_keys (10), location_points
(2), routes (7), route_stops (58), optimization_runs (4); identical MD5
checksums for jobs, routes and route stops; PostGIS 3.4.2; 7 migrations;
16 RLS tables / 16 policies.

App-role check on restore: tenant A sees 14 own jobs, **0** foreign jobs, and a
foreign UPDATE affects **0** rows. Restore database dropped afterwards.

Caveats: this proves a dump/restore procedure, not a production backup system.
There is no schedule, WAL/PITR, off-host retention or quarterly restore drill;
restore was performed as superuser with `--no-owner` (production should use an
ownership-preserving restore or reassign ownership deliberately). Retention for
`location_points`, `optimization_runs`, addresses and audit/outbox rows still
requires a business/legal decision.

## 3. Cache integrity

- Fleet proposal input hash includes `resultSchemaVersion: 2` (added with the
  jobs fix), so pre-fix cached results cannot be served.
- Cached fleet results are now validated by `assertFleetResultComplete` before
  being returned: service stops vs single-stop count, pickup stops vs shipment
  count, one pickup + one delivery per shipment on the same route, no duplicate
  or contradictory identities, and total distance/duration consistency.
- Regression: a persisted result deliberately stripped of service stops is
  rejected with `ROUTING_INVALID_RESPONSE`; a valid cache hit still returns the
  same run; the API maps incomplete results to a 502 with an honest message and
  they are not approvable.
- Tenant isolation for cache keys remains covered (query filters tenant id).

## 4. Load smoke (synthetic, isolated tenant)

Workload mix: 90% single-stop jobs requiring a vehicle-specific capability,
10% paired shipments, 80 distinct hubs plus vehicle depots (89 matrix
locations), all jobs assigned, seed tenant data included. Real OSRM/VROOM;
API/DB local. No customer data used.

| Stage | Total | Matrix | Solve | Geometry | Routes | Unassigned |
|---|---|---|---|---|---|---|
| 50 vehicles / 500 jobs | 3,150 ms | 237 ms | 651 ms | 1,561 ms | 45 | 0 |
| 100 vehicles / 850 jobs | 6,342 ms | 226 ms | 2,115 ms | 2,461 ms | 90 | 0 |

Hard guards (fail before expensive external work):

- **Matrix locations > 100** -> 422 `PLAN_TOO_LARGE` (OSRM deployment
  `max-table-size` is ~100; 120-location experiments returned OSRM 400).
- **Solver tasks > 1,000** (`2 x shipments + jobs`) -> 422 `PLAN_TOO_LARGE`
  (VROOM max-locations is 1,000). 100 vehicles / 1,000 jobs with this mix is
  1,126 tasks and was rejected in 1.86 s; use batching or raise the VROOM
  deployment limit deliberately.
- Provisional pilot budgets: <= 10 s end-to-end for 100 vehicles / <= 1,000
  tasks, matrix <= 1 s, solve <= 5 s. These are engineering thresholds, not
  contractual SLAs.

Not measured: CPU/memory, DB pool utilisation, sustained concurrency, p95
latency, solver-under-load behaviour. The load test is single-run, not a soak.

**Additional real-service defect found and fixed:** VROOM 1.13 skill values are
integers, not strings. Capability names are now mapped deterministically to
per-request integer ids; without this, any job/vehicle with skills caused
`400 Invalid skill value` (the fake-only capability tests could not reveal it).

## 5. Unresolved operational items

1. Expo/Metro build-tool advisories (9; no API runtime path; upgrade plan required).
2. Public exposure/TLS and firewall verification.
3. Scheduled backups, off-host retention, PITR and a recurring restore drill.
4. TLS/reverse proxy, firewall/public-exposure verification.
5. 100 vehicles / 1,000 jobs single-batch capacity (task limit); batching or
   VROOM deployment tuning decision.
6. Load resource measurements (CPU/memory/pool) and concurrency/soak.
7. Data retention/export/deletion decisions for locations, addresses and audit.
8. In-memory rate limiter/Socket.IO rooms remain single-instance by design.

## Conclusion

**Pilot readiness: CONDITIONAL - not signed off.** Tenant isolation, auth
abuse controls, runtime dependency remediation, restore procedure, cache
correctness, routing identity and bounded load behaviour now have code-level
evidence (API 63/63, auth/fleet 11/11, demo 13/13, web 21/21,
typecheck/lint/build green). The software is frozen at the handoff commit; the
remaining gates are operational: TLS/reverse proxy, public firewall
verification, scheduled/off-host backups and PITR, sustained load/concurrency
measurement, retention sign-off and Expo/Metro build-tool advisory upgrades.
Operator runbook: `docs/16d-operational-handoff.md`.
Do not expose the API or routing ports publicly until every pre-exposure box is
checked.
