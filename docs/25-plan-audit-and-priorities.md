# PrivateFleet — plan audit and next priorities

Date: 2026-11-01  
Live commit: `09cd6df` + assignment invariant (this change)  
Environment: LAN pilot, Windows host `<lan-host>`, synthetic data only.

This audit maps the original phased plan to what is actually deployed and
tested. “PASS” means evidence exists in the repository and/or the live system.
“Not verified” is not the same as “broken”; it means no reproducible evidence
has been produced yet.

---

## 1. Phase-by-phase status

### Phase 0 — Validate the problem

| Item | Status | Evidence / gap |
|---|---|---|
| Named design partner | **NOT DONE** | No customer commitment recorded |
| Real dispatcher workflow documented | **PARTIAL** | Product flows documented; no external operator sign-off |
| Baseline metrics agreed | **NOT DONE** | No stops/day, on-time %, exception baseline from a real operator |
| Licence/implementation scope agreed | **PARTIAL** | Internal £10K analysis only; no signed scope |
| 120-second demo rehearsal | **PARTIAL** | Product demo exists; no timed rehearsal evidence |

**Conclusion:** Phase 0 commercial validation is still the largest unclosed
risk. It cannot be closed by engineering.

### Phase 1 — Demo / Honey Pot

| Item | Status | Evidence |
|---|---|---|
| Monorepo, contracts, Fastify API | **PASS** | 23 API test files |
| Dispatcher screens | **PASS** | Live Operations, Dispatch Board, Jobs, Optimisation, Exceptions, Customer Tracking |
| Driver screens | **PASS** | Expo app, foreground GPS, POD |
| Real API (not mocked) | **PASS** | Live API + PostgreSQL |
| Seeded scenarios/simulator | **PASS** | Demo mode + seed data |
| E2E | **PARTIAL** | Earlier E2E green; not rerun after latest dispatch changes |
| Hands-free 120s demo | **NOT VERIFIED** | No scripted rehearsal run |

### Phase 2 — Backend and tenancy

| Item | Status | Evidence |
|---|---|---|
| PostgreSQL/PostGIS migrations | **PASS** | `0011` applied; policy tables live |
| Auth JWT + refresh rotation | **PASS** | 90 API tests pass |
| RLS tenant isolation | **PASS** | RLS tests; policy tables RLS enabled |
| Server-authoritative job lifecycle | **PASS** | arrive/complete/skip/evidence |
| Command idempotency | **PASS** | idempotency keys + tests |
| Transactional outbox | **PASS** | outbox events for jobs/routes |
| Orphan-assignment invariant | **PASS (new)** | approval + repair SQL; 15 repaired |

### Phase 3 — Driver workflow

| Item | Status | Evidence |
|---|---|---|
| Native Expo release build | **PASS** | signed release APK, bundled JS |
| Real assignments/job actions | **PASS** | live queue, arrive/complete/skip |
| Offline command queue | **PASS** | durable queue, conflict handling |
| Evidence/POD | **PASS** | photo/signature, duplicate-safe |
| Real driver completes real job | **PASS (pilot)** | physical S22, Tom |
| Dispatch updates without refresh | **PARTIAL** | Socket.IO exists; latest map not re-verified end-to-end |

### Phase 4 — Live tracking

| Item | Status | Evidence |
|---|---|---|
| GPS ingestion | **PASS** | telemetry rows over LAN and Tailscale |
| Hot/cold split + staleness | **PASS** | stale flag/provenance, 60s policy |
| Socket.IO rooms/snapshot | **PASS (code)** | earlier E2E; not re-run today |
| Field tracking | **PASS** | live pin from S22 |
| Background/screen-off tracking | **PASS (native client)** | screen-off test moved 17→25 telemetry rows; 8-hour battery soak pending |
| Reliable accuracy filtering | **PASS** | 75 m accuracy + teleport guard |
| Off-route warning only on fresh GPS | **PARTIAL** | stale pins still shown with stale label |

### Phase 5 — Optimisation and dispatch policy

| Item | Status | Evidence |
|---|---|---|
| OSRM matrix + geometry | **PASS** | 30-job regression |
| VROOM solve | **PASS** | 1.15 digest-pinned |
| Visit-order preservation | **PASS** | `db50c4c`, regression test |
| Proposal/approval/versioning | **PASS** | v114, v119, v120, v121 |
| Policy presets + revisions | **PASS** | Local/Balanced/Extended |
| Per-vehicle overrides | **PASS** | API + UI |
| Stale policy rejection | **PASS** | live 409 |
| Baseline gate | **PASS** | distance/coverage/working duration |
| New-scope gate comparison | **PASS** | `09317cd` |
| Hard distance/travel/visit limits | **PASS** | VROOM-enforced |
| Cost-aware recommendations | **PASS (advisory)** | endpoint + UI, 4 tests |
| Automatic partial assignment | **PARTIAL** | VROOM leaves unassigned; no explicit per-job reason beyond solver |
| Driver “request more jobs” | **PASS (request/decision)** | durable request + dispatcher decision; assignment/re-optimisation still missing |
| Dispatcher one-click assign recommendation | **NOT DONE** | advisory only; requires atomic assign + re-optimisation |

### Phase 6 — Pilot hardening

| Item | Status | Evidence |
|---|---|---|
| DNS for `.home.arpa` | **PASS** | dnsmasq, phone resolves |
| External access | **PASS** | Tailscale Serve, mobile-data health |
| TLS/internal CA | **PASS (app)** | APK trusts Caddy CA; browser still needs CA install |
| Backups scheduled | **PASS (operational)** | `.dump.age` to Google Drive |
| Restore drill | **PASS (earlier)** | 2026-10-28 report; not repeated on latest schema |
| Legal/driver-hours compliance | **NOT DONE** | working duration is an estimate |
| Retention/DPIA | **NOT DONE** | required before medical data |
| Monitoring/alerting | **PARTIAL** | logs only; no alert channel |
| Load/soak | **PASS (earlier)** | 100/850; not repeated after latest changes |
| Dependency audit | **PARTIAL** | runtime clean; Expo/Metro advisories remain |

---

## 2. What is 100% certain today

1. **90/90 API tests pass**; web production build passes.
2. Tenants are isolated by RLS; policy tables have RLS enabled.
3. The driver app on a physical Galaxy S22 can send foreground GPS to the API
   over the LAN and over Tailscale mobile data, and rows appear in PostgreSQL.
4. The release APK is standalone (embedded JS), trusts the Caddy CA and uses
   `https://pf-node.tail060a86.ts.net`.
5. The 30-job regression publishes compliant routes:
   - Mo 134.0 km / 38 visits,
   - Sarah 77.4 km / 22 visits,
   - total 211.4 km, 0 unassigned, gate allowed.
6. Dispatch policy revisions are persisted, optimisation stores the revision,
   and stale proposals are rejected with `409 STALE_DISPATCH_POLICY`.
7. VROOM is pinned by digest to 1.15.0 and enforces `max_distance`.
8. Route geometry, published stops, arrivals and VROOM visit order agree.
9. Automatic route completion and manual route closure both exist.
10. The live board now satisfies: **every `assigned` job is on a published
    route** (15 orphan assignments repaired).
11. Cost-aware recommendations return fuel/vehicle/wage/detour advice without
    auto-assigning.
12. DNS and Tailscale external access are working; PostgreSQL is not exposed.

---

## 3. Pending / not verified — ordered by risk

### P0 — needed before calling this a pilot product

1. **Phase 0 customer validation** — a named operator, metrics and scope.
2. **Background GPS** — native client screen-off PASS; 8-hour battery soak, release signing and full native parity remain.
3. **Cross-tenant demo-data cleanup** — a unique `(tenant_id, reference)`
   index already exists and is enforced. Duplicate-looking references such as
   `J-191` are in different tenants, not integrity violations. Remaining work
   is retiring the load/E2E tenants and cleaning duplicate driver names before
   demonstrations.
4. **Load-test tenant isolation/cleanup** — global route versions up to 237
   from `load-8d0a3a98` confuse version history and baselines.
5. **E2E/soak rerun** on latest code; earlier evidence predates policy/gate/map
   changes.
6. **Restore drill** on the current schema (policy tables, new migrations).

### P1 — product completeness

7. Driver “Request more jobs” — request/decision loop deployed; one-click assignment and re-optimisation remains.
8. Dispatch-origin resolver (depot, driver/dispatcher confirmation, fresh GPS).
9. One-click “assign recommendation and re-optimise” with atomic publication.
10. Plain-language unassigned reasons beyond `SOLVER_UNASSIGNED`.
11. Browser CA installation / trusted certificate path for dispatcher devices.
12. Monitoring/alerting and operational runbook automation.

### P2 — commercial / hardening

13. Licensing, DPIA, retention, drivers’ hours compliance review.
14. 30-day reliability evidence and support SLA.
15. Multi-instance rate limiting / shared limiter.
16. Expo/Metro dependency advisory upgrade.
17. 120-second demo rehearsal and leave-behind collateral.

---

## 4. What to build next

See `docs/27-stage-plan-review-and-build-order.md` for the consolidated,
commercial-gate-first build order. The items below are retained as the detailed
engineering backlog.

### Next 1 — Data integrity and demo isolation (recommended first)

- confirm the existing `(tenant_id, reference)` unique index in CI,
- archive or delete the load-test tenant through an audited reset,
- close historical published routes that are neither active nor completed,
- add an invariant test that `assigned` jobs must have a route stop.

This protects every future demo and every optimisation baseline. It is the
highest-value engineering task because stale data has repeatedly caused false
incidents (Tom’s v100 route, duplicate `J-191`).

### Next 2 — Driver request to assignment

Durable request, dispatcher recommendation, route-impact preview, approval
that re-optimises the remaining work and preserves completed/in-progress stops.

### Next 3 — Native release readiness

Release signing, 8-hour battery soak, offline/conflict matrix and push update channel.

### Next 4 — Dispatch-origin resolver

Depot/shift policy, fresh-GPS request, driver/dispatcher confirmation,
LIVE/STALE/DEPOT map states.

---

## 5. Current live numbers (audit snapshot)

```text
Policy:          local, revision 42, 120 km / 30 visits
Published:       v121, 3 routes, 30 stops each
Jobs:            assigned 45, completed 14, unassigned 15
Orphan assigned: 0  (approval invariant + repair)
Unique jobs:     (tenant_id, reference) index enforced live
VROOM:           ghcr.io/vroom-project/vroom-docker@sha256:247d5683... (healthy)
API:             200
Web:             200
```
