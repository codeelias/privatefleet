### v1.70 - Stationary-aware location engine (2026-11-03)
- Native 1.0.12: StationaryGate movement classifier with hysteresis and parked position hold; source arbitration (network ignored while GPS fresh); per-fix pf-diag logging (accuracy, age, timestamps, speed/bearing accuracy, displacement, decision).
- movementState added to telemetry/vehicle contracts and location_points (migration 0017); dispatcher HUD shows movement state and an accuracy ring for the selected vehicle.
- No Kalman, no RTK changes; standard-GPS pipeline only.
### v1.69 - Revert default positioning to validated provider flow (2026-11-03)
- Field feedback: fused EKF output was not better than plain GPS and added visible motion. Reverted TelemetryService to GPS 10 s + network 15 s raw-fix posting (accuracy filter 150 m).
- EKF/RTKLIB remain compiled but dormant; quality fields still reported; web marker tween restored to 1.8 s.
- 1.0.11 (versionCode 12) published and installed on R5CWB0BR3BP; Phone 1 pending reconnection.
### v1.68 - Accuracy reliability redesign (2026-11-02)
- Removed IMU position integration (rumble source); constant-velocity EKF with damped velocity.
- Stationary and innovation-gated fixes snap exactly to GNSS; filter output can no longer be worse than raw GNSS.
- Network provider fallback restored; accuracy now reported per-axis.
- 1.0.10 (versionCode 11) published; installed on R5CWB0BR3BP. Phone 1 install pending reconnection.
### v1.67 - Phone 2 on 1.0.9 (2026-11-02)
- R5CWB0BR3BP updated in place to 1.0.9; Mo Khan session persisted; native bridge ready; dead-reckoning gating verified (no posts after 15 s indoors).
- Both pilot phones now run the positioning-stable 1.0.9.
### v1.66 - Positioning stability fix (2026-11-02)
- Fixed EKF covariance propagation (F P F^T cross-terms were wrong), added analytic regression test.
- Velocity only fed above 2 m/s; stationary speed noise no longer wanders the pin.
- Dead reckoning capped at 15 s after the last GNSS fix; telemetry cadence 1050 ms to stay under the API rate limit.
- 1.0.9 (versionCode 10) published and installed on RFCW10QT5ZE; Phone 2 install pending reconnection.
### v1.64 - Both pilot phones on fixed 1.0.8 with remembered sessions (2026-11-02)
- Phone 1 RFCW10QT5ZE replaced with the fixed 1.0.8, Tom Cole signed in; session persisted after cold restart; JNI bridge ready.
- Tom's stored PIN did not match the seeded 1234 and could not be recovered, so it was reset to the pilot PIN 1234 and verified through the login API.
- Phone 2 R5CWB0BR3BP already verified with Mo Khan signed in and remembered.
- Both phones report fused GNSS/IMU tracking and native RTK bridge ready; RTK remains unsupported until a correction stream is configured.
### v1.63 - Phone 2 installed, signed in, JNI packaging fixed (2026-11-02)
- Fixed a release-blocking JNI bug: CMake declared C-only, so pf_rtk.cpp was excluded and the first 1.0.8 APK crashed with UnsatisfiedLinkError. Enabled CXX and verified all five JNI exports before republishing.
- Phone 2 R5CWB0BR3BP updated in place 1.0.4 -> fixed 1.0.8, signed in as Mo Khan, session persisted after cold restart; native RTK bridge logs ready; telemetry posting (RTK unsupported until corrections are configured).
- Phone 1 RFCW10QT5ZE holds the earlier bridge-less 1.0.8 and is currently disconnected; it needs the fixed APK when reconnected.
- Republished APK SHA-256 8d2b23ae2899d2eb01cf4f1acf9554a00ad8175968014113b9858cf187ab39a0.
### v1.62 - Native 1.0.8 installed on the physical phone (2026-11-02)
- Tom's phone RFCW10QT5ZE was on a debug-signed 1.0.0, which cannot be updated in place. Uninstalled and clean-installed release-signed 1.0.8 (versionCode 9).
- Verified: app launches to the driver sign-in screen, no crash. App data was cleared by the signature migration, so the driver must sign in again.
- Phone 2 R5CWB0BR3BP remains unavailable; install pending.
### v1.61 - RTKLIB solver compiled into the native app (2026-11-02)
- Native 1.0.8: RTKLIB 2.4.3 vendored and compiled via NDK 27.1/CMake into libpf_rtk.so (all ABIs).
- JNI bridge feeds Android raw observations + RTCM corrections into rtkpos (kinematic RTK); TelemetryService publishes rtk_fixed positions only from actual solver output.
- Not yet validated against a live base station; the 0.10 m fixed-mode accuracy is nominal until the ground-truth campaign.
### v1.60 - RTK correction transport and precision gate (2026-11-02)
- Native 1.0.7: NTRIP RTCM stream client, local correction config, PrecisionState machine and an RtkSolver boundary whose default implementation can never claim float/fixed.
- Telemetry/vehicles now carry rtkState and correctionAgeMs (migration 0016); dispatcher HUD labels the precision state honestly.
- Verification: NtripClient + PrecisionState JUnit tests, API telemetry round-trip, native 1.0.7 build.
### v1.59 - Raw GNSS quality + IMU EKF positioning (2026-11-02)
- Native 1.0.6: raw GNSS quality monitor (satellites, L1+L5, carrier-phase validity), IMU prediction and a pure 2D EKF producing 10 Hz fused fixes; telemetry throttled to 1 Hz.
- No sub-metre claim: no corrections/RTK source is present. Confidence and estimated error are shown instead.
- Location points and fleet vehicles now carry source, satellitesUsed, dualFrequency, carrierPhase, ekfConfidence (migration 0015).
- Dispatcher navigation HUD shows the fused-fix quality; marker tween reduced to 0.95 s.
- Verification: native EKF JUnit 4/4, API telemetry quality test, native 1.0.6 build/install on emulator, API/Web deployed.
### v1.58 - Tile-policy compliance and visual geofence editor (2026-11-02)
- Removed all default requests to OpenStreetMap's volunteer tile servers after their tile usage policy blocked the app.
- Vector basemaps (OpenFreeMap) remain the primary engine; the no-WebGL raster fallback is now a tile-free Leaflet surface where routes, vehicles and overlays still render, with an explicit "tile-free raster surface" label.
- A licensed raster provider can still be configured via VITE_MAP_RASTER_TILES.
- Added a dedicated Geofences screen: draw polygons on the map, drag vertices, insert midpoints, remove vertices, undo/redo, live self-intersection/size validation, driver scoping (including "select drivers inside"), job linking, edit and delete.
- Geofence evaluation now respects per-driver scope; enter/exit events and alerts carry the linked job id.
- Verification: API 101/101, web engine 53/53, full E2E 21/21; production tile requests verified zero against volunteer servers.
### v1.57 - Premium map-first refinement (2026-10-29)
- Header reduced to a single toolbar: text navigation, orange active underline, no nav capsule.
- Fleet overview is a hairline-divided status rail; expanded cards remain optional.
- Vehicle panel defaults to compact, with explicit Expand/Minimise/Close text actions and GPS age in expanded detail; launcher reopens compact.
- Unassigned drawer label/card typography refined; compact exception summary appears in the selected-vehicle card.
- Dark map filter lifted; light map fallback; selected route orange, inactive routes cool grey-blue when a selection exists.
- Route casing, SVG grip icons, WCAG tokens/focus retained.
- Caddy proxies /socket.io so Global Live is the real connection.
- Verified one route-geometry request across all toggles; drawer does not resize map. Demo 13/13, auth/fleet 11/11, web 21/21, API 65/65.
### v1.56 - Map-first dispatcher, optional panels, accessibility pass (2026-10-29)
- Compact 44px fleet overview with expand/collapse and local preference; map uses all remaining height.
- Selected vehicle is a floating panel with expanded, compact, closed and launcher states; map never reserves a column.
- Unassigned jobs is a 40px collapsed drawer that expands over the map without resizing it; demo and postgres both start collapsed.
- Active vehicle KPI now counts non-inactive/non-maintenance vehicles; global socket status is separate from per-vehicle GPS-stale labels.
- Map light/dark toggle, stronger orange route casing, WCAG-calibrated warm tokens, visible focus and 32px panel controls.
- Caddy now proxies /socket.io to the API so Global Live reflects the real WebSocket connection.
- Playwright: one /v1/fleet/routes request across all panel/drawer/overview/style toggles; map height unchanged when drawer opens.
- Verification: demo 13/13, auth/fleet 11/11, web 21/21, API 65/65, typecheck/lint/build green.
# Documentation Changelog & Verification Record

Records what changed in the documentation package and the automated checks that keep it trustworthy. Re-run the checks after any PR that touches `docs/` - the docs-as-code rule ([13](13-development-methodology.md)) applies to this file too.

## Version history

### v1.6 - ASCII hardening (2026-10-27)
- A background process on this machine repeatedly re-saved markdown files through a legacy codepage, corrupting non-ASCII characters (em dashes, arrows, box drawing, check marks) mid-session. All files were repaired, then the entire package was converted to ASCII-only. ASCII is invariant under any codepage round-trip, so the package is now immune to this failure class.
- Substitutions: em/en dash -> '-', arrow -> '->', bullet -> '*', middot -> ' / ', multiplication -> 'x', check marks -> '[x]', circle -> 'o', '>='/'<=', ellipsis -> '...', section sign -> 'Section ', pound sign -> 'GBP ', box drawing -> '+', '-', '|', 'v', '>'.
- New standing rule (recorded in [13.2](13-development-methodology.md)): all documentation is ASCII-only from now on.

### v1.54 - Pool and 5xx measurement closure (2026-10-29)
- Tagged API pool sessions with application_name; sampler reads only those sessions as the stats role, separate from the monitor.
- Final 100/850 soak: 35,999/35,999 reads at 20.0/s, p95 133 ms; telemetry 8,997x200 at 5.0/s; 59 optimisations, 56 approved, p95 5.74 s; ordinary 5xx 0/59 = 0.0%.
- API pool: 897 samples, max 10, checked-out avg 1.23/max 7, saturation p95 30%, 100% <80%, lock waiters 0.
- Outage version 200 unchanged; three 502 VROOM_UNAVAILABLE failures all inside the exact outage window. Harness outageEnd-null classification bug fixed.
- CPU not re-sampled this run (previous 40.4%); client pool wait queue not exposed.

### v1.53 - Fleet read-path split, gzip and passing 100/850 soak (2026-10-29)
- /v1/fleet/state now supports includeRoutes=false; route geometry moved to versioned GET /v1/fleet/routes. API host gzip enabled.
- Measured snapshot: 11.36 MB / 2.3 s -> 568 KB / 97 ms; route geometry 10.8 MB / 671 ms fetched once per published version.
- Full open-loop 100/850 soak (1,800 s): 35,999/35,999 reads at 20.0/s, p95 129 ms; telemetry 8,996x200 at 5.0/s; 59 optimisations, 56 approved, p95 5.74 s; outage version 75 unchanged, 502; CPU 40.4% core, memory avg 376/max 516 MB.
- DB-pool saturation and ordinary non-outage 5xx remain NOT VERIFIED. UI verified: 3 routes, 3 markers, no map warnings/demo controls.
- Verification: API 65/65, web 21/21, typecheck/lint/build green.

### v1.52 - Full 100/850 soak, cloud backup verification, malformed-JSON fix (2026-10-29)
- Malformed JSON now returns 400 `INVALID_JSON` with no internal detail; API tests 64/64.
- Off-host Google Drive backup now works via interactive user task `PrivateFleet Cloud Backup`; file + checksum verified in `G:\My Drive\PrivateFleet_Backups`, restored successfully (RTO 2.4 s). Task requires Amela logged on; external-device sync/download still unverified.
- Full 30-minute 100/850 soak: **FAIL on read throughput** (3,300 reads ~1.8/s vs 20/s; p95 7.3 s), telemetry 825x200 (~0.46/s vs 5/s); optimisation 55/55 approved, p95 5.9 s; VROOM outage preserved version 20 and returned typed 502. CPU +1,550 s (~85% core), memory avg 614/max 749 MB, DB 10.8/11.
- Conclusion: snapshot read payload/latency is the next scalability work; routing limits stay unchanged.

### v1.51 - LAN deployment execution: Caddy/PG/PostGIS, backup/restore, load and API soak (2026-10-29)
- Native Windows pilot deployment on `192.168.1.128`: Caddy 2.11.7 internal TLS at `https://app.privatefleet.home.arpa`; PostgreSQL 16.10 + PostGIS 3.6; API on loopback behind Caddy; OSRM/VROOM rebound to `127.0.0.1` on an internal Docker network. Firewall verified from a LAN client: only 443/80 reachable; 4000/5432/5000/3000 closed.
- HTTP proposal/approval: 26 stops, 2 service identities, version 2; identity gate assignments/stop IDs verified. Deployed UI verified in a browser (3 routes, 2 SINGLE JOB labels).
- Encrypted daily age backup scheduled (SYSTEM, 02:00) to `D:\PrivateFleet_Backups`; restore drill 1.0-1.2 s with 14 jobs/3 routes/26 stops, RLS 16/16, foreign rows 0. `G:\My Drive` is inaccessible to the service account: off-host copy remains **NOT VERIFIED**; USB local backup passed.
- 100/850 deployed load: 5.29 s (matrix 205 ms, solve 1.96 s, geometry 1.73 s, 90 routes, 0 unassigned). 30-minute API soak: 36,000 reads/0 errors, read p95 198 ms, optimisation p95 207 ms, 11 DB sessions; run on 3-vehicle tenant, no telemetry load -> PARTIAL for specified workload.
- Paths: CA `C:\Caddy\root.crt`; age private key `C:\privatefleet\age_private_key.txt` (move offline). Public exposure not externally verified; no router forwarding.
- Docs: `docs/16e-lan-deployment.md`, readiness/handoff updated. No application code changes; all software remains frozen at `a667d9d`.
### v1.50 - Auth limiter edge-case regression and operational handoff (2026-10-28)
- Shared-IP limiter behaviour is now explicitly covered: Account A exhausting its five-failure bucket does not block Account B on the same depot IP; when the IP aggregate reaches 50 failures in the window, all accounts behind that IP receive 429 `AUTH_RATE_LIMITED` with `Retry-After` until expiry. Documented as an intentional anti-spray trade-off.
- Published `docs/16d-operational-handoff.md`: deployment checklist (TLS/Caddy, DNS, CORS, firewall, secrets/env manifest), encrypted scheduled off-host backup and restore drill, RPO/RTO and PITR decision slots, 100-vehicle load/30-minute soak protocol with provisional thresholds, retention decision table and ordered pre-exposure checklist.
- Final software freeze: API 63/63, auth/fleet E2E 11/11, demo E2E 13 passed / 13 skipped, web 21/21, typecheck 6/6, lint 6/6, build 5/5. Remaining gates are operational (TLS, firewall verification, scheduled PITR/backups, soak, retention sign-off, Expo toolchain advisories) and require the deployment host/pilot partner.

### v1.49 - Auth abuse controls and Zod 4.6.6 security remediation (2026-10-28)
- Staff login and driver PIN verification now use a bounded, dual-key sliding-window limiter (account/device + source IP): defaults 5 failures/account/min and 50/IP/min; 429 `AUTH_RATE_LIMITED` with `Retry-After`; no permanent lockout; successful login clears only the account bucket; LRU-bounded state; shared-IP users independent. Unit tests cover threshold, expiry, shared IP, success reset and memory bounds; API integration covers throttle, shared-IP login, recovery and driver PIN.
- Zod upgraded 3.25.76 -> 4.6.6 via the workspace override (advisory fixed). API/contracts/web/Expo typechecks and suites pass with Zod 4. Remaining 9 publish advisories are all Expo/Metro build-tool paths (PostCSS, image-size, node-forge, uuid, deepmerge), not the API runtime.
- Docs: readiness report auth-abuse gate PASS (single-instance), dependency gate runtime PASS / build-tooling OPEN; runbook throttling note.
- Verification: API 62/62, auth/fleet E2E 11/11, demo E2E 13 passed / 13 skipped, web 21/21, typecheck 6/6, lint 6/6, build 5/5.

### v1.48 - Production-readiness hardening: RLS, restore drill, cache validation, load guards (2026-10-28)
- RLS probe: runtime role `privatefleet_app`, 16/16 tenant tables have policies; cross-tenant SELECT/UPDATE/DELETE affect 0 rows; foreign INSERT rejected; repeat verification on a restored database.
- Auth: JWT secret minimum raised to 32 chars; short access TTL and refresh rotation/revocation already covered. Auth rate limiting/lockout remains an open pilot risk.
- Request hardening: 256 KiB body limit, bounded fleet `driverIds`, nosniff/frame/referrer headers, explicit CORS allowlist.
- Cache integrity: cached fleet results validated before return; corrupted/legacy results rejected with `ROUTING_INVALID_RESPONSE`; `resultSchemaVersion=2` pins cache identity.
- Capacity guards: matrix locations <=100 (OSRM limit) and solver tasks <=1000 (VROOM limit) fail fast with 422 `PLAN_TOO_LARGE`.
- Real defect fixed: VROOM 1.13 requires integer skills; capability names map deterministically to per-request integer ids (string skills caused 400s).
- Backup/restore drill: 437 ms dump, 679 ms restore, identical counts/checksums, app-role isolation verified, temp DB dropped. No automated backup/PITR yet.
- Load smoke (real services): 50/500 = 3.15 s; 100/850 = 6.34 s (90 routes, 0 unassigned); 100/1000 rejected cleanly (1126 > 1000 tasks, 1.86 s).
- Verification: API 55/55, auth E2E 11/11, demo E2E 13 passed / 13 skipped, web 21/21, typecheck 6/6, lint 6/6, build 5/5. Report: `docs/16c-readiness-report.md`. Pilot readiness CONDITIONAL.
### v1.47 - Fleet dispatcher UI: review and atomic approval (2026-10-28)
- Optimization screen live mode now runs the verified fleet endpoints (`POST /v1/optimization/fleet-run`, `POST /v1/optimization/fleet/:runId/approve`) instead of the single-driver presentation. Demo mode and its fixture workflow are unchanged.
- Renders one route panel per vehicle with ordered stops, explicit SINGLE JOB / PICKUP / DELIVERY labels, per-route distance and duration, fleet totals, solver arrival times only when absolute, and a structured unassigned-work panel with human reasons (MISSING_SKILL, CAPACITY_EXCEEDED, etc.).
- One approval action with duplicate prevention, stale `409 ROUTE_VERSION_STALE` explanation (no blind retry), retained published plan on failure, and authoritative `["fleet"]` query invalidation after approval so map/board render persisted state.
- Typed `HttpError` (status + code) in the web client for honest stale/failure handling.
- Dispatcher acceptance: new `tests-auth/fleet-ui.spec.ts` proves multiple vehicle routes, mixed unit types, unassigned reason, one atomic publish with persisted version/assignments, and stale approval never shown as published. Auth suite now seeds a dedicated fleet tenant (deterministic against driver-test mutations).
- Verification: auth E2E 11/11, demo E2E 13 passed / 13 skipped, API 49/49, web unit 21/21, typecheck 6/6, lint 6/6, build 5/5.
- The previous single-driver live E2E spec is superseded by the fleet dispatcher spec (UI no longer exposes that path in postgres mode). Native background tracking/geofencing remain out of scope.

### v1.46 - Fix single-stop job loss at the routing factory; identity-level real gate (2026-10-28)
- Root cause proven: `createRoutingClients` wrapped `VroomClient.solve` without forwarding the new fifth `jobs` argument. The direct service trace passed jobs explicitly (26 stops); the real HTTP app path silently dropped them before VROOM (24 stops, 0 service stops). Cache and controller mapping were ruled out by tracing the fresh service result.
- Fix: the factory now forwards `jobs`; regression test captures the outgoing VROOM body and asserts the job step maps back to the domain id.
- Planner completeness invariant is now fail-closed: every submitted job/shipment must be assigned exactly once or explicitly unassigned by the solver; unknown, duplicated, contradictory or omitted units throw `ROUTING_INVALID_RESPONSE`. Cached fleet results include `resultSchemaVersion: 2` in their input hash so pre-fix results cannot be served.
- Real OSRM/VROOM gate now asserts persisted identities, not just counts: 12 paired shipments + 2 single-stop jobs -> 14 business units, 26 route_stops (16/6/4), 2 persisted service stops, per-route shipment counts 7/3/2, pickup-before-dropoff per route, persisted job assignments equal the approved proposal, version 2, 3 outbox events.
- Verification: API 49/49 (factory forwarding + completeness invariant added); demo E2E 13 passed / 13 skipped; auth E2E 10/10; typecheck 6/6, lint 6/6, build 5/5.
- Dispatcher fleet UI remains untouched/unwired; next increment resumes it on this verified base. Pushes remain paused.
### v1.45 - Domain constraints and single-stop jobs in fleet optimisation (2026-10-28)
- Migration 0006: `vehicles.capacity_units`, `vehicles.required_capabilities`, `jobs.required_capabilities`, `jobs.service_seconds` (tenant-scoped; null/empty means unconstrained, no silent defaults).
- VROOM adapter now supports single-stop **jobs** alongside paired shipments, vehicle/job skills, capacity, service durations and integer matrices; solution parsing preserves interleaved solved order and solver-provided arrival times.
- `planFleet` handles jobs + shipments in one matrix solve with deduped locations and per-vehicle geometry in exact solved order.
- Fleet service: single-stop jobs are optimised (no longer `MISSING_PICKUP_OR_DROPOFF`); paired work requiring capabilities no vehicle has is explicitly `MISSING_SKILL`; capacity mode requires all vehicles configured (partial config -> `CONSTRAINTS_INCOMPLETE`); zero capacity paired work -> `CAPACITY_EXCEEDED`; solver-unassigned work carries its reason; constraint values are part of the input hash/cache identity.
- Verification: API 47/47 including new single-stop, skill and capacity tests; real fleet gate with real OSRM/VROOM now returns **0 unassigned** (single-stop jobs placed), 3 vehicles / 12 shipments / 9 matrix locations / 3 routes / version 2 / 24 route_stops; typecheck 6/6, lint 6/6, build 5/5.
- Not yet: dispatcher UI rendering of fleet proposals (next increment); ETA display is prepared in the contract but not surfaced in the workbench; native background tracking remains queued.
- Pushes remain paused (owner directive); local commits only.
### v1.44 - Fleet-wide multi-vehicle planning with atomic publication (2026-10-28)
- `planFleet`: one VROOM solve over many vehicles/shipments, deduplicated matrix locations, integer ids/matrices, per-vehicle road geometry in solved order, explicit unassigned work.
- Fleet proposal service + endpoints (`POST /v1/optimization/fleet-run`, `POST /v1/optimization/fleet/:runId/approve`): persisted run with full solved snapshot (assignments, expected fleet version, dataset id), assignment-aware input hash.
- Atomic publication in one tenant transaction: stale version/assignment snapshot -> 409 ROUTE_VERSION_STALE, all affected routes superseded and reinserted at one shared version, route_stops, job reassignments, per-route outbox events, `route_ids` linkage; concurrent approvals idempotent; failed insert rolls back everything.
- Real-service fleet gate: 3 vehicles, 12 shipments, 8 matrix locations, routes 5/5/2, 58,494 m / 9,500 s, version 2, 24 route_stops, 3 events, 781 ms.
- Real-service preservation gate: published plan (geometry SHA-256, version, stops) unchanged with VROOM stopped; proposal 502 VROOM_UNAVAILABLE; a new job manually assigned (200) without routing; geometry unchanged after.
- Evidence tightening: full registry manifest digests + local image ids + platform + dataset SHA in the runbook; controlled-environment deployment claim clarified.
- Verification: API 45/45 (5 new fleet tests incl. rollback/concurrency/cache/tenant isolation), demo E2E 13/13, auth acceptance 10/10, typecheck 6/6, lint 6/6, build 5/5.
- Remaining: capacity/skills/service-duration constraints not modelled; fleet proposal not yet rendered in the dispatcher UI; native background tracking.
- Pushes remain paused (owner directive); local commits only.

### v1.43 - Real OSRM/VROOM deployment gate passed (2026-10-28)
- Lifted the engineering freeze per owner directive and resumed the real routing deployment gate.
- Loaded pinned images offline (Docker SSH credential helper unusable): OSRM `osrm/osrm-backend:v5.25.0` (id a16438df8826) and VROOM `vroomvrp/vroom-docker:v1.13.0` (id ae19c5666266); prepared the pinned Geofabrik Greater London extract (sha256 CFD5085...BBD0D) with car.lua + MLD partition/customize on the Docker host.
- Real gate through production HTTP path: propose 146 ms; 4 unique matrix locations; 6 stops; 0 unassigned; 16,692 m / 2,697 s; 1,465 geometry points; stale approval 409 ROUTE_VERSION_STALE; published version 2; snapshot version 2 with 1,465 route points; 1 run, 6 route_stops, 1 outbox event; 642 ms total.
- Outage gate: VROOM unreachable -> 502 VROOM_UNAVAILABLE; fleet snapshot stayed 200 with unchanged routeVersion and routes (no destruction of published plans).
- Real services exposed four adapter defects, fixed: `amount` sent without vehicle capacity; string shipment ids (VROOM requires integers); float matrix entries (VROOM 1.13 requires integers); duplicate stop locations producing invalid matrices (now deduplicated with an index map).
- New `scripts/registry-pull.mjs` (constrained-host image loader), `src/db/routing-live-gate.ts` gate script; optimization test env isolated from routing variables.
- Verification: API 40/40; typecheck 6/6; lint 6/6. Demo mode unchanged; demo/auth E2E re-run follows this commit.
- Remaining per directive: fleet-wide multi-vehicle optimisation with atomic publication, then native background tracking.
- Pushes remain paused (owner directive); local commits only.
### v1.42 - Phase 1 demo frozen: boot verified, deployment runbook, Phase 4/5 paused (2026-10-28)
- Owner directive: pause Phase 4/5 build work (no Docker services, real OSM extracts, multi-vehicle routing or native background GPS) until a design partner signs a pilot contract. No application code changed in this freeze.
- Demo boot verified from a clean start: `pnpm dev` -> demo API on 4000 (`readyz`: demoMode=true, repositoryMode=demo), dispatcher `http://localhost:5173`, driver `http://localhost:5174` (Vite binds localhost; `127.0.0.1` is not served by plain `pnpm dev`). Fleet state: 3 vehicles, 12 jobs, 3 routes, demoMode=true.
- Full regression at freeze: API 40/40; demo E2E 13 passed/13 skipped; auth + driver + live-routing acceptance 10/10; web 21/21; driver 6/6; Expo 3/3; typecheck 6/6; lint 6/6; build 5/5; encoding clean.
- New [16b - Production deployment runbook](16-production-deployment-runbook.md): pinned OSRM v5.25.0 and VROOM v1.13.0, Geofabrik Greater London extract with SHA-256, extract/partition/customize commands, service health checks, Postgres/API env, real-service acceptance gate, rollback and known limitations.
- Docker deployment attempt recorded honestly: the host at 192.168.1.128 is reachable over SSH (Docker Desktop 4.95.0, engine 29.8.2), but image pulls from that SSH session are blocked by Docker Desktop's credential helper; no containers were installed, no production services were started, and the host configuration was restored exactly as found. The container-backed gate remains the first post-signature task.
- Frozen baseline unchanged: demo remains default and internet-independent for boot (public map tiles are the only online dependency; routes and markers still render without them).
- Pushes remain paused (owner directive); local commit only. Next action is commercial, not engineering.
### v1.41 - Phase 5: dispatcher live-proposal UI and end-to-end publish acceptance (2026-10-28)
- Route Optimisation screen now branches on mode: postgres/live shows engine + version + run id, km/min estimates, solved stop order, unassigned-work warning, and publishes via the stale-version-checked approval endpoint; demo mode keeps the seeded simulated proposal unchanged.
- New web API calls `runOptimizationLive` and `approveLivePlan`; live publish reports the published route version.
- Acceptance against the real UI + postgres API with a protocol-faithful fake OSRM/VROOM service: propose -> publish -> `routeVersion` 2 with one published route.
- Harness note: Node 22 fetch rejects port 4190 (undici blocked ports); fake routing runs on 4191.
- Verification: auth acceptance 10/10, demo E2E 13/13, API 40/40, web unit 21/21, typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Remaining: multi-vehicle planning, real OSRM/VROOM container deployment check, Expo native background location.
- Pushes remain paused (owner directive); local commits only.
### v1.40 - Phase 5: durable optimization runs, route publication and snapshot routing (2026-10-28)
- Migration 0004: `routes` (validated geometry persisted at publish), `route_stops`, `optimization_runs`, tenant-scoped with RLS coverage.
- `createProposal`: loads pending assigned pickup/dropoff pairs, runs OSRM matrix -> VROOM -> road geometry, persists run with input hash/engine/version/metrics, and reuses stored runs for identical inputs (cache).
- `approveProposal`: transactional publish - stale `expectedRouteVersion` rejected with 409 `ROUTE_VERSION_STALE`, new immutable version inserted, previous published route superseded, ordered route_stops written, run linked, `route.published` outbox event emitted; re-approval idempotent.
- `GET /v1/fleet/state` now serves persisted routes and the database-authoritative `routeVersion` (postgres mode).
- New dispatcher-only endpoints `POST /v1/optimization/run` and `POST /v1/optimization/:runId/approve`; typed 503 when routing is not configured so manual dispatch is unaffected.
- Verification: API 40/40 incl. 3 optimization persistence/publication tests; demo E2E 13/13 (demo untouched); auth acceptance 9/9; typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Remaining: dispatcher UI wiring to the live proposal shape, multi-vehicle planning, real OSRM/VROOM container deployment check.
- Pushes remain paused (owner directive); local commits only.
### v1.39 - Phase 5: OSRM/VROOM provider layer behind the validated route contract (2026-10-28)
- New `apps/api/src/modules/routing/`: OSRM matrix/route adapter with response validation, VROOM matrix-mode shipment solver adapter, and `planShipments` (matrix -> solve -> road geometry -> invariant checks, unassigned work surfaced).
- Typed routing errors (`ROUTING_NOT_CONFIGURED`, `OSRM_UNAVAILABLE`, `VROOM_UNAVAILABLE`, `ROUTING_INVALID_RESPONSE`, `PLAN_INFEASIBLE`); `OSRM_BASE_URL`/`VROOM_BASE_URL` config requires both or neither.
- Evidence: 6 provider tests against fake HTTP services (validated plan, infeasible surface, bad geometry, unreachable OSRM/VROOM, factory rules); live OSRM smoke produced a 3x3 matrix and a 524-point 5.18 km geometry for a London request. VROOM had no local Docker, so its adapter is protocol-tested against a fake service; container validation remains a deployment check.
- Not yet: durable optimization_runs/proposal persistence, preview/publish endpoints with stale-version rejection, dispatcher UI wiring. Demo fixtures remain the default.
- Verification: API suite green, typecheck/lint/build green.
- Pushes remain paused (owner directive); local commits only.
### v1.38 - Phase 4: device location sharing, bounded retry buffer and per-device rate limits (2026-10-28)
- Driver app "Share location" control: browser/device geolocation -> bounded sample buffer (50) -> batched authenticated posts every 5 s; failed batches merge back ahead of the cap so retries never lose location truth.
- New `apps/driver/src/shared/location-buffer.ts` with unit tests for cap, ordered drain and failure merge.
- Per-device telemetry rate limit (10 batches / 10 s, in-memory): 429 + `Retry-After` + uiMessage; unit and API integration coverage.
- Browser acceptance `driver-telemetry.spec.ts`: granted geolocation moves through the real driver UI and API, and the dispatcher's authorised snapshot shows the position within 120 m; stale flag false.
- Verification: auth + driver acceptance 9/9, API 31/31, driver unit 6/6, web 21/21, demo untouched; typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Remaining Phase 4: geofence transitions, Expo native background location, shared limiter state at scale.
- Pushes remain paused (owner directive); local commits only.
### v1.37 - Phase 4: real GPS telemetry ingestion and authenticated tenant rooms (2026-10-28)
- New `POST /v1/telemetry` for driver devices: batches of 1-50 samples, vehicle derived from the authenticated driver, never the body.
- Durable cold history `location_points` (server-assigned monotonic `sequence_no`, unique per vehicle) plus hot `vehicles` position update in one tenant-scoped transaction; RLS includes the new table.
- Monotonic ingestion: samples at/before the current position are rejected as stale; future samples beyond 5 minutes are invalid; per-sample results returned.
- Socket.IO production handshakes now require a valid access token and join a server-derived tenant room; telemetry publishes tenant-scoped with 1 s per-vehicle coalescing. Client sends the token through the session hook.
- Snapshot recovery reads the hot position columns, preserving the staleness rule.
- Verification: API 27/27 plus realtime tests 2/2 (tenant room isolation, unauthenticated rejection); demo E2E 13 passed / 13 skipped; auth+driver acceptance 8/8; typecheck/lint/build green.
- Demo mode remains default and unchanged; migrations applied to the dev database.
- Pushes remain paused (owner directive); local commits only.
### v1.36 - Phase 1 freeze: true-paint metrics, 2x DPI, route versions, debug grid (2026-10-28)
- Latency now measures time-to-visible-pixel: socket receipt -> React commit -> canvas draw -> rAF -> post-paint task. Snapshots report `basis: "after-paint"`.
- True-paint benchmark (250 vehicles, 2530 samples): p95 72.4 ms at 1x DPR; 159.5 ms at 2x; frame p50 16.7 ms, p95 33.4 ms, 41.1 FPS vs map-only 42.7 FPS at 1x. 2x keeps frame parity (39.5 FPS) so DPI stays at min(devicePixelRatio, 2) for sharpness.
- Authoritative route versioning: `RoutePath.version` + `FleetState.routeVersion`; API stamps routes, bumps on publish, and rejects stale `expectedRouteVersion` with 409 `ROUTE_VERSION_STALE` + uiMessage. Store test covers stamp/bump/reject; scenario test asserts route versions match the authoritative value. Geometry signature is now only a client display guard.
- Debug alignment grid behind `?debug=map`: adaptive 10m-class geographic lattice drawn in the same projection, with an acceptance test.
- Verification: API 24/24, web unit 21/21, demo E2E (including debug grid, DPR and benchmark specs) run recorded below, typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Phase 1 frozen: no further headless rendering optimisation without a measured regression. Deferred: real-GPU 60 FPS measurement, Phase 4 live GPS ingestion, Phase 5 OSRM/VROOM publication.
- Pushes remain paused (owner directive); local commits only.
### v1.35 - Interpolated canvas markers: glide restored without frame-cost regression (2026-10-28)
- New `engine/interpolation.ts`: monotonic-clock tweens, retargeting from the current animated position, clamped (no indefinite extrapolation), reduced-motion instant snap. Four unit tests.
- Canvas marker layer now animates between accepted telemetry positions on one continuous rAF loop that stops when every marker settles; pan/zoom re-projects instantly.
- Paired benchmark (map-only reference in the same run): clean-host fleet p50 16.8 ms equals map-only 16.8 ms; loaded-host runs show fleet p50 33.3-50.0 ms against map-only 33.3 ms. Fleet latency p95 72-98 ms (contract 1000 ms). The residual tail is host/software-raster, present with 3 vehicles too.
- Honest limitation kept in docs/17.12: sustained 60 FPS average is environment-bound; real-GPU measurement still outstanding.
- Verification: demo E2E 11 passed / 11 skipped, web unit 21/21, API 23/23, typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Pushes remain paused (owner directive); local commits only.
### v1.34 - Accepted map performance optimisation: canvas markers, coalescing, sprite cache (2026-10-28)
- High-count fleets (>40 vehicles) now render through a single canvas marker layer with hit-tested selection; small demo fleets keep the rich DOM pins (initials, tooltips, drag-and-drop). Canvas layer uses a 1x backing store and cached sprites.
- Telemetry is coalesced into one animation-frame flush (newest sample per vehicle) *only* for GPS positions; business events keep their existing socket/outbox path.
- Measured on the identical 250-vehicle benchmark, with a map-only reference added: marker latency p95 275 ms -> 81 ms; frame p50 33.4 -> 16.8 ms (60 Hz); frame p95 133 -> 33.4 ms; avg FPS 20.7 -> 38.4, equal to the map-only reference (38.6) in the same headless software-raster environment.
- Gate status recorded honestly: marker latency PASS; smoothness now at map-only parity (p50 60 Hz); sustained 60 FPS average is environment-bounded and needs a real-GPU measurement, documented as the remaining caveat rather than claimed.
- Rejected experiment (React scheduling + transform motion, docs/17.10) stays reverted.
- Verification: demo E2E 11 passed / 11 skipped (scenarios, movement, selection, stale, reconnect, malformed geometry, benchmark), web unit 17/17, API 23/23, typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Pushes remain paused (owner directive); local commits only.
### v1.33 - Benchmark-driven optimisation attempt reverted (2026-10-28)
- A/B tested telemetry coalescing + memoised pins + transform-based motion against the recorded baseline, four benchmark runs per variant on the same machine.
- Result: regression - median FPS ~18.0 baseline vs ~15.6 optimised; frame p50 worsened from 33.4 ms to 50.0 ms consistently; marker latency unchanged within noise (p95 236-285 ms both).
- Decision: reverted in full under the protected-baseline rule; nothing from the experiment shipped. Marker latency contract still met (p95 ~275 ms); smoothness contract still failed (~18 FPS at 250 vehicles).
- Conclusion recorded in docs/17.10: scheduling changes cannot fix this; the credible path to 60 FPS is a canvas/WebGL marker layer (Leaflet canvas renderer or MapLibre symbol source), to be gated by the same benchmark and full E2E suite.
- Verification after revert: web unit 15/15, typecheck clean, encoding clean; working tree equals committed baseline `34edb35`.
- Pushes remain paused (owner directive); local commits only.
### v1.32 - 250-vehicle benchmark harness and baseline (2026-10-28)
- Demo-only load harness: `POST /v1/demo/load {count}` adds synthetic vehicles on closed London loops through the real simulator/socket path; `DELETE /v1/demo/load` clears them. Never registered outside demo mode.
- Browser instrumentation gated by `/?benchmark=1`: accepted-GPS -> visible-marker latency per vehicle (React commit) and rAF frame sampling, exposed as `window.__fleetBench.snapshot()`; no-ops otherwise.
- Reproducible Playwright gate (`map-benchmark.spec.ts`): 250 vehicles, 20 s sample, 2530 valid latency samples, JSON artifact attached.
- Recorded baseline (docs/17.9): marker latency p50 141 ms, **p95 275 ms (PASS <= 1 s)**, p99 331 ms; frame p50 33.4 ms, **p95 133 ms, 20.7 FPS (FAIL smoothness target)**. Environment recorded: Win11, i7-7700HQ, 32 GB, Playwright 1.64.1 headless Chromium (software raster), 1440x900.
- Quality gate status is PARTIAL: latency contract met, smoothness contract failed. Next increment: animation-frame telemetry coalescing and transform-based pin animation, then re-run the same benchmark and record final numbers. No optimisation is claimed as done.
- Verification: benchmark test passes as a measurement; API 23/23, web unit 15/15, demo E2E (with benchmark) next run; typecheck/lint/build green.
- Pushes remain paused (owner directive); local commits only.
### v1.31 - Map alignment audit: full-resolution geometry, snap audit, coordinate-order boundary (2026-10-28)
- Response to a reported route-line offset: checked coordinate order, CRS, snapping, rendering offset and simplification against the actual data path (docs/17.8).
- Coordinate order is now enforced at one boundary: `engine/projection.ts` emits `[lng, lat]` for GeoJSON/MapLibre and `[lat, lng]` for Leaflet, with unit tests asserting both for the same point.
- Fixtures regenerated: full-resolution OSRM geometry with 1.5 m Douglas-Peucker simplification (replacing every-5th-vertex sampling), `radiuses=120` per waypoint, and each waypoint's snap distance recorded. Certification rejects snaps outside 0-100 m; observed maxima are 58.2 m (VAN-02), 57.4 m (proof VAN-02), 38.4 m (VAN-04, CAR-03). A 50 m radius was rejected by OSRM (NoSegment) because some stop coordinates are venue points up to ~58 m from the drivable edge.
- Measured old-vs-new geometry deviation: max **1.5 m** across all nine fixtures, so vertex downsampling was not the cause of a multi-metre visual offset.
- Honest conclusion recorded: geometry is OSRM centreline within 1.5 m, order/CRS are test-guarded and no line-offset exists; a larger parallel offset against the rendered base map is most plausibly base-map generalisation at the current zoom, and needs engine + zoom + an application screenshot to diagnose. No claim is made that this change fixes a >2 m visual offset.
- Verification: API 23/23 (fixture certification includes the snap audit), web unit 15/15, demo E2E 10 passed / 10 skipped, typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Still pending for the quality gate: the reproducible 250-vehicle benchmark and recorded p95 latency/frame times (docs/17.5).
- Pushes remain paused (owner directive); local commits only.
### v1.30 - Map quality standard foundation: validated routes, ordered telemetry, protected baseline (2026-10-28)
- Protected baseline rule documented (docs/17): every change must pass the full gate set and measurably improve quality, or it is reverted. Baseline recorded at `73639a8` with green gates.
- New pure map-engine modules with unit tests (12 cases): `geo.ts` (coordinate validity, route invariants, stable geometry signatures), `routes.ts` (valid/invalid reconciliation, last-verified-route retention, change detection), `telemetry.ts` (monotonic ordering by sequence + capture time, invalid-sample rejection, staleness, newest-per-vehicle coalescing).
- App wiring: telemetry handler accepts only newer samples (out-of-order cannot move a marker backwards); a 2 s heartbeat ghosts vehicles after 10 s without fresh data; scenario reset clears accepted-track state.
- MapCanvas wiring: routes are validated before drawing, only invalid routes are hidden, the last verified route is retained on a routing failure with an honest warning, and the MapLibre route source is updated only when the geometry signature changes instead of on every GPS tick.
- Audit recorded (docs/17.2): monolith map component, per-telemetry GeoJSON re-serialisation, blind telemetry merge, no validation/retention, no map unit tests.
- Verification (before and after the change): web unit tests 12/12; repo unit/integration 41 (29 + 12); demo E2E 7 passed / 7 skipped; typecheck 6/6, lint 6/6, build 5/5, encoding clean. No existing behaviour regressed.
- Pending for the quality gate (documented targets): browser acceptance for stale/reconnect/malformed geometry, and the reproducible 250-vehicle benchmark with p95 GPS-to-visible latency and frame times. Measurements will be recorded in docs/17.5 before the gate is called green.
- Pushes remain paused (owner directive); local commits only.

### v1.29 - Phase 3 complete: offline queue contract tests, conflict banners, skip coverage (2026-10-28)
- Offline queue contract tests for BOTH driver clients (`apps/driver/src/shared/client.test.ts`, `apps/driver-expo/src/queue.test.ts`, 3 each): a network failure keeps the command pending with the same idempotency key across retries; a 4xx becomes an explicit conflict carrying the server `uiMessage` and is persisted with `status: conflict`; concurrent flushes share one in-flight run (fetch called once).
- Conflict-aware sync banner in both apps: conflicts render the danger tone with "N action(s) need attention - refresh your queue"; pending commands show the queued count with the retry explanation; offline copy unchanged.
- Driver lifecycle test now also covers `skip` with a reason: the driver token skips their stop, and the dispatcher's fleet view shows the job `skipped`.
- Root `test` task excludes the e2e package (`--filter=!@privatefleet/e2e`); browser gates stay explicit (`pnpm e2e`, `pnpm e2e:auth`).
- Phase 3 objective evidence: unit/integration 29 (API 23 + driver 3 + Expo 3); `pnpm e2e:auth` 8/8 including RN-web and Expo driver workflows that complete a real assigned job and prove the dispatcher sees the authorised update; demo E2E 7 passed / 7 skipped; typecheck 6/6, lint 6/6, build 5/5, encoding clean.
- Known limitation (documented in ADR-0009): native iOS/Android builds need EAS credentials or a local toolchain; the verified transports are RN-web and Expo-web.
- Pushes remain paused (owner directive); local commits only.

### v1.28 - Phase 3: Expo driver application, verified end-to-end on web (2026-10-28)
- New `apps/driver-expo` workspace app: Expo SDK 53 / React Native 0.79 / react-native-web, `app.json` for iOS, Android and web (SPA export), babel + tsconfig wired for Metro.
- The Expo app implements the same server contract as the RN-web driver: PIN device login (`/v1/auth/driver-login`), tenant-scoped `/v1/driver/queue`, shift start, arrive/complete/skip with idempotency keys, session refresh with single-flight + forced refresh on 401, and a durable offline queue in AsyncStorage (pending on network failure, explicit conflict on 4xx, one flush at a time). Hold-to-confirm uses the single-fire ref pattern so a hold cannot spam commands.
- API now supports explicit CORS origins (`CORS_ORIGINS`, comma-separated, default off) for browser-hosted builds; only the configured Expo origin is allowed.
- Expo runtime acceptance: the exported web bundle is served statically and driven by Playwright against the real postgres API - sign in, queue, hold-to-arrive, POD completion, and the dispatcher's fresh view shows the job completed. A second deterministic seed job (J-001) keeps the RN-web (J-000) and Expo flows independent.
- Verified: `pnpm e2e:auth` 8/8 (auth, RN-web driver workflow, Expo web driver workflow); API 23/23; demo E2E 7 passed / 7 skipped; typecheck 6/6, lint 6/6, build 5/5; encoding clean; Expo `export --platform web` bundles 188 modules / 397 kB.
- Not yet verified: native iOS/Android builds - they require EAS credentials or a local Android/iOS toolchain that this workstation does not have; the RN-web and Expo-web builds are the verified transports (ADR-0009 update).
- Pushes remain paused (owner directive); local commits only.

### v1.27 - Phase 3: driver app production mode, offline queue hardening, browser acceptance (2026-10-28)
- Real driver bug fixed: the hold-to-confirm control kept a stale interval reference, so one hold fired `onConfirm` on every tick after the threshold - duplicate arrive commands (one 200, the rest 409). Now a ref-held interval with a single-fire guard confirms exactly once.
- Driver app production mode: detects `/v1/meta`; demo mode keeps the profile picker, postgres mode shows a device sign-in (workspace + driver ID + PIN) and uses `GET /v1/driver/queue` plus `POST /v1/driver/shift/start`. Session persists with `accessTtlMs`; expiry triggers one single-flight refresh; a 401 forces a real refresh before retry; failure clears the session back to sign-in.
- Offline queue hardening: `flush` is single-flight (concurrent `online` events cannot dispatch the same command twice); failures are typed (`HttpError`): 4xx becomes an explicit conflict surfaced to the driver, network/5xx keeps the command pending for retry. Commands keep stable idempotency keys across retries.
- API: refresh rotation now also supports driver subjects (`auth_driver_by_id` SECURITY DEFINER lookup) so a device session survives token expiry without re-entering the PIN.
- Seed: Morning Rush assignments are applied to seeded postgres tenants (drivers have real work), plus a deterministic single-stop job `J-000` for device acceptance (documented demo fixture).
- Browser acceptance (`pnpm e2e:auth`, 7 tests now): driver signs in on the device UI against the real API, holds to arrive, completes the POD, and the dispatcher's fresh authenticated view shows the job `completed` with every stop completed.
- Verification: API 23/23 (driver suite now 8 incl. seeded J-000 path), demo E2E 7 passed / 7 skipped, auth+driver acceptance 7/7, typecheck 5/5, lint 5/5, build 4/4, encoding clean.
- Remaining for Phase 3: Expo native scaffold (blocked locally by ~2.8 GB disk headroom; native build needs Expo tooling plus an Android/iOS toolchain), and conflict-surfacing UI copy for offline queues on the shift screen.

### v1.26 - Phase 3: driver device identity and tenant-scoped driver workflow (2026-10-28)
- Drivers now have device credentials: `drivers.pin_hash` (argon2id) added by migration 0002; `pnpm db:seed` sets demo PIN `1234` for seeded drivers (documented demo data, not a production credential policy).
- `POST /v1/auth/driver-login` (tenant slug + driver id + PIN) issues a JWT with role `driver` and subject = driver id; wrong PIN, unknown driver and cross-tenant driver ids all return the same 401.
- Driver device routes in postgres mode: `GET /v1/driver/queue` returns only the token driver's assigned jobs (staff tokens get 403 DRIVER_DEVICE_ONLY), `POST /v1/driver/shift/start` puts the driver and vehicle on route.
- Token identity is authoritative on job actions: driver tokens can only arrive/complete/skip their own stops; a mismatched body driverId is rejected 403 rather than trusted, so a device cannot spoof another driver.
- Tests (22/22 total, 7 new): driver login, wrong PIN, staff/tenant rejection on the driver queue, own-jobs-only queue, shift start, spoof rejection, and arrive + complete with idempotent replay where the dispatcher's fleet state shows the completed job, the other driver's job untouched, and exactly one `job.completed` event.
- Verification: typecheck 5/5, lint 5/5, build 4/4, demo E2E 7 passed / 7 skipped.
- Remaining for Phase 3: driver web UI in postgres mode (login, real queue, offline command queue conflict surfacing) and the Expo native scaffold; disk headroom (~2.8 GB) must be confirmed before pulling Expo dependencies.

### v1.25 - Phase 3 entry slice: scenario-wide route consistency, certified stop order, distance-based movement, auth hardening (2026-10-28)
- Assignment truth extracted to `modules/demo/assignments.ts`, shared by the in-memory store and the route-fixture generator, so board assignments, rendered geometry and simulated movement cannot drift apart.
- Route fixtures now exist for ALL THREE scenarios keyed by scenario and vehicle, including Proof of Service (Sarah's own circuit through the J-198 stops). Each fixture carries the generator's engine-snapped waypoint indices, certifying that OSRM passed the assigned stops in the approved order.
- New deterministic API test (`route-geometry.test.ts`): every scenario/driver route starts at the driver, is dense, and its certified waypoints are monotonic and within 120 m of each assigned pickup/dropoff in order. Sequence is certified here because proximity alone cannot order stops on an out-and-back circuit.
- Fixed a real simulator units bug: `haversineMetres` mixed radians with metres-per-degree, shrinking cumulative distances ~57x and making vehicles jump ~700 m per tick. Movement is now genuinely speed x time (40 km/h, 2 s ticks) with interpolation inside the containing segment.
- Stronger browser gate (`map-routes.spec.ts`): valid finite London-range coordinates (also a coordinate-order guard), route origin within 150 m of the vehicle, every assigned stop within 120 m of its driver's route, route/vehicle/driver consistency, per-scenario resets, distance-over-time movement (0.5x-2x of speed x elapsed), selection highlight, scenario switching, and no false geometry warning. Pin-movement assertions now poll rather than assume a fixed wait.
- Documented tolerances and the demo-vs-production distinction in `docs/16-routing-engine-architecture.md` and ADR-0013 (renderer never invents routes; OSRM Table + VROOM + OSRM reconstruction + validation + versioning is the Phase 5 pipeline; planned route / live GPS / historical trace stay separate).
- Auth follow-ups: refresh rotation is now atomic (UPDATE ... WHERE revoked_at IS NULL RETURNING, so a concurrent second refresh loses the race instead of branching tokens) with a new concurrent-refresh test; ADR-0012 records stateless access-token/logout semantics and the compensating 15-minute TTL; docs/12.8 documents the viewport-guarded skips and that CI runs the union.
- Verification: demo E2E 7 passed / 7 skipped; auth acceptance 6/6; API integration 15/15 (6 auth + 6 fleet + 3 fixture certification); typecheck 5/5; lint 5/5; build 4/4; encoding clean.
- Remaining limitations: fixtures are demo data (live OSRM/VROOM integration stays in Phase 5); production tolerances will come from engine snap distances and address accuracy; access tokens remain valid up to 15 minutes after logout by design until a Phase 6 revocation denylist is justified.

### v1.24 - browser login, auth acceptance gate, road-following routes (2026-10-28)
- Login screen (production mode only): tenant slug + email + password, accessible validation, loading/disabled state, uiMessage-only errors. Session stored with access expiry; a 401 triggers one refresh per the contract and a retry; failed refresh clears the session back to login. Sign out clears local state and invalidates the server session. Header shows the authenticated tenant name. Demo mode (`REPOSITORY_MODE=demo`, the default) bypasses authentication entirely, so Phase 1 behaviour and its tests are unchanged.
- Browser authentication acceptance suite (`pnpm e2e:auth`, dedicated postgres-mode stack on 4002/5176 with a 3-second access TTL): valid login shows the tenant's fleet; invalid login is clear and exposes no raw details; expired access token refreshes transparently (rotated tokens asserted); revoked refresh token fails safely to login with local state cleared; logout kills the server session (replay gets 401); tenant isolation (a session sees only its own tenant, foreign fleets are empty).
- Refresh horizon made TTL-aware (min(15s, ttl/2)) so short-lived test tokens do not rotate on every request.
- Road-following routes (acceptance gate): precomputed OSRM demo geometry committed as fixtures (`route-geometry.ts`, 659-759 points per vehicle, out-and-back circuit starting at the driver position and visiting each Morning Rush assignment's pickup and dropoff). Labelled demo data per the contract; Phase 5 replaces them with live OSRM/VROOM.
- Simulator moves along that same geometry (point-unit step, one loop per ~450 ticks = ~15 min, plausible city speed); rendered routes, vehicle markers and stops all come from one scenario state. Selecting a vehicle highlights its route (bright/thick) and dims the others in both engines. A missing-geometry state shows an honest amber notice instead of wrong lines.
- Route acceptance test (`map-routes.spec.ts`): geometry density >=100 points, route starts within 400m of the vehicle, every assigned stop within 400m of the driver's route, selection highlight (stroke 5 vs 3), movement stays on-route, scenario switching keeps routes consistent, no false geometry warning.
- Encoding guard (`scripts/check-encoding.mjs`, also runnable with `--check`): repository text files must be UTF-8 without BOM. A BOM in package.json broke Vite's PostCSS loader and prevented the login screen from rendering; 40+ files were stripped and CI can assert cleanliness.
- Dev DB resilience: `ensure-db` now detaches a WSL keeper so Postgres survives the test process (WSL otherwise shuts the distro down and kills the server mid-run).
- Verification: demo E2E 6 passed / 4 skipped; auth acceptance 6/6; API integration 11/11; typecheck 5/5; lint 5/5; build 4/4; encoding clean. Pushes remain paused (owner directive).

### v1.23 - Phase 2 gate complete: CI Postgres, seed, smoke, honest service types (2026-10-28)
- CI: new `api` job with a `postgis/postgis:16-3.4` service, PostGIS extension + non-owner app role bootstrap, owner-run migrations/RLS, then the 11 integration tests (auth, RLS cross-tenant, lifecycle, idempotency). The e2e job is unchanged.
- Seed: `pnpm db:seed` provisions a tenant with the Phase 1 dataset (3 drivers, 3 vehicles, 12 jobs + stops, alert) and prints its slug; `pnpm db:smoke` boots the real app in postgres mode, logs in, snapshots the fleet and performs an idempotent assign - verified end to end (12 jobs / 3 drivers / 3 vehicles, assign `assigned`, replay stable, job status `assigned`).
- Design correction: `service_type` is tenant-configurable text (labels like "STAT pickup", "Clinic", "Transfer" are core to the product); the fixed enum was removed via migration 0001.
- Fixed: seed jsonb parameter (drizzle/postgres.js object param), duplicate tenant slug on re-seed, and the smoke replay comparison (JSONB key order).
- Verification: API tests 11/11, typecheck 5/5, lint 5/5, build 4/4, demo E2E 5 passed / 3 skipped (demo mode unchanged and still the default).
- Phase 2 exit gate: migrations, JWT+refresh auth, RLS with composite tenant keys, server-authoritative lifecycle, command idempotency, transactional outbox, and cross-tenant probes on API + repository + database layers - all covered by automated tests. Phase 3 (driver workflow) is next; pushes remain paused (owner directive).

### v1.22 - Phase 2 lifecycle: idempotent commands, outbox, tenant isolation (2026-10-28)
- `PgFleetService` (postgres mode) implements the same API surface as the demo: snapshot, assignment preview, assign, arrive, complete, skip, alert acknowledge/resolve - all authenticated, tenant-scoped inside a transaction with `app.tenant_id` (RLS), with job_events audit rows and outbox rows written in the same transaction.
- Command idempotency: `idempotency_keys` replay returns the stored response byte-for-byte; a repeated keyed command never double-writes. Missing keys fall back to a deterministic per-command key for assign.
- Outbox publisher: committed events are published to the tenant Socket.IO room after the transaction (realtime bus now derives the room from the event tenant); a durable polling worker remains Phase 4 hardening.
- Tests (11/11): auth lifecycle (register/login/refresh rotation + replay/me), RLS cross-tenant probes (hidden rows, blocked WITH CHECK), fleet snapshot isolation (tenant B sees zero jobs, anonymous 401), idempotent assign replay with exactly one job_event and one outbox row, assignment conflict, arrive->complete with job completion, illegal transition rejection, wrong-driver 403, alert acknowledgement with audit.
- Fixed: Postgres timestamps arrive as Date or ISO string depending on the driver path - mappings now normalise both; alert status updates cast the enum; fire-and-forget outbox publishing now awaited (no dangling queries after shutdown).
- Fixed: UTF-8 BOMs written by PowerShell into root and apps/api package.json broke Vite's PostCSS config loader - stripped; all package.json files verified to parse.
- Demo mode remains the default and the full E2E suite still passes (5 passed / 3 skipped).
- Pushes remain paused (owner directive); local commits only.

### v1.21 - Phase 2 foundation: Postgres, RLS, auth (2026-10-28)
- Local infrastructure: PostgreSQL 16 + PostGIS 3.4 provisioned in WSL Ubuntu-24.04 (`scripts/db-up.ps1`, `pnpm db:up`); two connection roles per the approved RLS design - `privatefleet` (owner, migrations/seeds) and `privatefleet_app` (non-owner, runtime, so RLS is actually enforced). `ensure-db` self-heals the WSL idle shutdown at every DB entry point (migrate, tests).
- Schema (Drizzle, ADR-0005): tenants, users, drivers, vehicles, jobs, job_stops, job_events, alerts, outbox, refresh_tokens, idempotency_keys, demo_scenarios - tenant_id on every operational table, composite unique keys (tenant+reference, tenant+email, tenant+key).
- Post-migration SQL: generated PostGIS geometry columns + GiST indexes for vehicles and stops, RLS policies for all tenant tables (USING + WITH CHECK), and SECURITY DEFINER auth bootstrap functions with a minimal surface (tenant by slug, user by email/id, refresh lookup).
- Auth module: register (tenant + owner), login (tenantSlug + email + argon2id), refresh with rotation and replay rejection, logout, JWT access tokens (HS256, 15 min, iss privatefleet) and `/v1/auth/me` behind a bearer guard. `/readyz` and `/v1/meta` now report repositoryMode.
- Demo mode is untouched and remains the default (`REPOSITORY_MODE=demo`); postgres mode activates with env vars documented in `apps/api/.env.example` (loaded via Node 22 loadEnvFile).
- Phase 2 gate progress: 5/5 integration tests pass against real Postgres with the app role - registration claims, wrong-password 401, refresh rotation + replay rejection, /me guard, and cross-tenant RLS probes (invisible foreign rows, blocked WITH CHECK insert). Repository/lifecycle/idempotency tests and CI Postgres service are the next stage.
- Note: `withTenant` runs real Drizzle transactions with `app.tenant_id`; Drizzle passes text params verbatim, so timestamps are sent as ISO strings (Date params break postgres.js Bind).
- Pushes remain paused (owner directive); local commits only.

### v1.20 - MapTiler key kept inactive until unrestricted (2026-10-28)
- The configured MapTiler key answers 403 "Key usage restricted" for localhost; the key line in gitignored `apps/web/.env.local` is now commented out, so the demo makes zero MapTiler requests (no 403 console noise, no pre-flight probe). Verified: 0 maptiler requests, 15 OSM tiles, no key warning badge, vector path goes straight to OpenFreeMap bright.
- Re-enable by fixing the key's allowed HTTP origins in MapTiler Cloud and uncommenting the line - the app validates before use either way.
- Pushes remain paused (owner directive); local commits only.

### v1.19 - config-driven map sources (provider pluggability) (2026-10-28)
- Map sources extracted to `apps/web/src/features/live-map/map-config.ts`: no tile host or style URL is hardcoded in the map UI. Providers are selected from `VITE_MAP_*` variables with a documented resolution order (explicit config, then MapTiler when a key exists, then approved B2 defaults: OpenFreeMap bright/liberty vector, OSM raster).
- `?map=vector|raster` overrides the engine per session; `VITE_MAP_ENGINE` sets the default. Markers, route overlays, projection and dispatch interactions are untouched by provider changes.
- Verified env-driven switching: overriding `VITE_MAP_RASTER_TILES`/`VITE_MAP_RASTER_NAME` changed the rendered provider with zero code edits (status read "raster tiles loaded (15 tiles, Configured Raster)"); the vector chain still resolves to OpenFreeMap bright.
- ADR-0010 amended with the provider-pluggability rule, the full stack split (MapLibre GL JS, OpenFreeMap demo tiles, MapLibre React Native for driver, PostGIS, OSRM, VROOM, PMTiles/self-hosted later) and the explicit production review trigger.
- Full E2E suite 5 passed / 3 skipped after the refactor. Pushes remain paused (owner directive); local commits only.

### v1.18 - MapTiler integration + key guard (2026-10-27)
- MapTiler wired through `VITE_MAPTILER_KEY` (apps/web/.env.local, gitignored) for both engines: vector style `basic-v2/style.json` (with OpenFreeMap bright/liberty retries, then raster) and Leaflet raster `basic-v2/{z}/{x}/{y}.png`.
- Diagnosis: the configured key answers 403 "Key usage restricted" with a **placeholder PNG** as the body, so `<img>` tiles still decode and render a watermark. A pre-flight `fetch` now validates the key before any MapTiler tile is attached; a non-200 key falls straight back to OSM with a dev-only amber notice naming the fix. Verified: 0 MapTiler images, 13 OSM tiles, status "raster tiles loaded (N tiles, OSM)".
- Owner action to enable MapTiler: MapTiler Cloud > Keys > "privatefleet" > allow http://localhost:5173 (and 127.0.0.1 / LAN IP), or clear origin restrictions; no code change required afterwards.
- Pushes remain paused (owner directive); local commits only.

### v1.17 - geographic map: correct locations, routes, and movement (2026-10-27)
- Fixed two real bugs: `advanceVehicle` computed interpolated positions but never stored them, and `fleetState` reported `route[0]` for every vehicle - so all GPS positions were frozen at the route start. The store now keeps `dto.location` in step with the simulated fix.
- `FleetState.routes` added to the contracts (vehicleId, driverId, GeoPoint[]); the API publishes each vehicle's route and the web map draws them as polylines (Leaflet `path.leaflet-interactive`, MapLibre geojson line layer).
- Map overlays now use real geographic projection (`map.project` / `latLngToContainerPoint`) instead of schematic percentages, re-projected on every pan/zoom and telemetry tick; vehicle pins animate along their route (verified: pin 308px -> 315px, vehicle 51.515216,-0.130904 -> 51.515432,-0.129808 over 4s).
- London `maxBounds` on both engines (panning restricted to Greater London); vector engine uses OpenFreeMap `bright` style (no key) per the reference example, liberty retry, then raster fallback.
- New permanent E2E regression test (`map.spec.ts`): routes present, positions change, polylines rendered, pin moves. Verified screenshot: 7161 unique colours, brightness 205.7, 5.68% route-blue line.
- Pushes remain paused (owner directive); local commits only.

### v1.16 - key-free tile providers (CARTO watermark removed) (2026-10-27)
- CARTO's raster service now returns "API KEY REQUIRED" watermarks baked into the tiles; every CARTO request has been removed from the app.
- Default demo engine (Leaflet raster): OpenStreetMap standard tiles (`tile.openstreetmap.org`), verified 15 tiles loaded, zero CARTO requests, screenshot measures 3840 unique colours / brightness 206 / 97% lit - a bright, detailed London map. Demo-scale use is within OSM's tile policy; a production provider is an ADR-0010 revisit.
- Vector engine (`?map=vector`, MapLibre): MapToolkit dark style (`styles.maptoolkit.org/dark.json`), verified style 200, sprites 200, `.mvt` tiles 200 - free for small commercial projects, no key. One-shot retry to OpenFreeMap liberty if the style fails, then the raster engine.
- Removed the CARTO-specific brightness filter; OSM tiles are naturally legible.
- Pushes remain paused (owner directive); local commits only.

### v1.15 - map visibility root cause fixed (2026-10-27)
- The map was rendering all along but CARTO Dark Matter's streets are nearly invisible: the actual tile file measured 16 unique colours and brightness 40, so the map card averaged brightness 42 - indistinguishable from the dark grid fallback. Proven by downloading the exact tile the app renders and pixel-analysing it.
- Fix: Leaflet is now the demo default (no WebGL dependency, CARTO Dark Matter at zoom 13) with a CSS brightness/contrast/saturation lift on the tile images; map card brightness rose 42.7 -> 99.4 with 97.9% lit pixels. Also fixed Leaflet's light-grey (#ddd) container background and themed its controls/attribution for the dark command center.
- Also fixed earlier in this pass: Leaflet fade-in left tiles at opacity 0.115 (now disabled - instant full opacity); honest chip text ("Tiles failed to load - check network"); MapLibre vector remains available via ?map=vector.
- Verification: Playwright screenshot of the map card (`screenshots/map-final.png`, gitignored) with 15 tiles at opacity 1 and the filter applied.
- Pushes remain paused (owner directive); local commits only.

### v1.14 - bodyless POST fix (the rehearsal red toast) (2026-10-27)
- Root cause of the red error toast finally isolated: every bodyless POST (scenario reset, Publish, Acknowledge, Resolve) sent `Content-Type: application/json` with an empty body, which Fastify rejects (FST_ERR_CTP_EMPTY_JSON_BODY) - surfaced as the 500 "Something went wrong on our side" message. The web and driver clients now normalize bodyless POSTs to `{}`.
- Regression guard added: the Morning Rush E2E now drives the scenario buttons through the real UI path (the previous tests bypassed it via direct fetch helpers - the gap that let this through).
- Favicon 404 silenced with a data-URI icon in both apps.
- E2E 3/3; pushes remain paused (owner directive); local commits only.

### v1.13 - rehearsal review fixes (2026-10-27)
- The prospect said yes; the rehearsal surfaced three review items, all fixed:
  1. Error toast: scenario resets now guard against double-fires, retry once automatically, and surface transient hiccups as an amber notice instead of a red server-blame banner; the stale background API that held port 4000 during the rehearsal was killed (their `pnpm dev` now boots cleanly).
  2. Real map: MapLibre GL renders OpenFreeMap dark tiles (ADR-0010) over London; the schematic grid remains only as an offline fallback layer. Ghost-pin and status markers stay as HTML overlays so drag targets are unchanged.
  3. Board density: 12 seeded jobs - 8 pre-assigned blocks (3/3/2 per lane) plus 4 unassigned cards, time slots tightened to 45 min so everything fits the 06:00-18:00 shift.
- E2E re-verified 3/3 against the new seeds. Pushes remain paused (owner directive); local commits only.

### v1.12 - rehearsal is the active gate; pre-Phase 2 preparation (2026-10-27)
- Active blocking task: the 120-second rehearsal (14.2b), then the demo in front of a real prospect; Phase 2 waits for the prospect's yes - nothing else.
- 14.1b amended: Phase 0 is the immediate next commercial action, not a parallel track.
- Tree audit: working tree clean; no WIP commits - the Phase 1 history is already a set of logical conventional commits (402e877..1215fe0), so no squashing was needed.
- Added scripts/generate-roi.ts: the ROI leave-behind generator (14.2c) - prospect baseline inputs become a one-page Markdown summary with every assumption printed; sample output in scripts/output/roi-leave-behind.md (ASCII-only, per policy).
- Pushes remain paused (owner directive); local commits only.

### v1.11 - Phase 1 complete (2026-10-27)
- Phase 1 (the Honey Pot demo) is implemented and verified: monorepo (pnpm + Turborepo), contracts package, dispatcher web app with all 5 screens, driver app with 3 screens (RN via react-native-web), DEMO_MODE Fastify API with the three seeded scenarios, simulated GPS, outbox-to-Socket.IO pipeline, ADR-0011 error mapping, and Playwright E2E for Morning Rush / Emergency / Proof of Service (3/3 passing locally; CI proven green on run 40588487908).
- Acceptance checklist (handoff section 10) status: all items met within Phase 1 scope; item 8 (tenant theme contrast) is exercised with the mock tenant and completes fully with real tenants in Phase 6.
- Repository note (owner directive 2026-10-27): pushes to GitHub are paused; all commits are local from v1.11 onward until further notice. Remote remains at commit 25ee384.
- Remaining human step: the 120-second rehearsal with the demo script (docs/14.2b) on the demo tablet.

### v1.10 - Playwright E2E scenarios (2026-10-27)
- Added `apps/e2e`: the three demo scenarios as executable acceptance tests (docs/12.2) against the real DEMO_MODE stack - Morning Rush (click assign + impact preview + budget timing), Emergency (drag J-208 onto a driver pin via dnd-kit), Proof of Service (driver completes both stops on the mobile app; server state asserted).
- CI gained an `e2e` job (setup-node 22 + pnpm + chromium) so every push proves the scenarios.
- Fixed a real client bug the tests caught: `request()` spread order dropped the `content-type` header whenever an idempotency key was set, so every command with headers failed validation - the tests paid for themselves immediately.
- Driver conflict surfacing: failed queue flushes now raise the server's uiMessage to the driver instead of navigating silently.

### v1.9 - driver app slice (2026-10-27)
- Added `apps/driver`: the three driver screens (Shift Home & Route Queue, Active Job with hold-to-confirm arrival, Proof of Service & Exceptions) in React Native components rendered on the web via react-native-web + Vite for the Phase 1 demo. Light theme per handoff Q1 (bg `#F8FAFC`, text `#0F172A`, primary `#2563EB`).
- Offline command queue per docs/06.4: stable idempotency keys, pending/accepted/conflict states, localStorage persistence on web (expo-sqlite replaces it in Phase 3 native), conflicts surface the server's uiMessage - no last-write-wins.
- Server-authoritative driver commands: shift/start, stop arrive, stop complete (with POD note), stop skip (raises a dispatcher alert) - all append audit events through the outbox.
- ADR-0009 note: the Phase 1 demo transports the RN codebase with Vite + react-native-web instead of the Expo CLI bundle; Expo CLI / EAS adopts the same components for native pilot builds in Phase 3.

### v1.8 - Phase 0 parked; orchestration target decided; Phase 1 begins (2026-10-27)
- Owner directive: Phase 0 (design-partner gate) is parked as a parallel commercial track and no longer blocks implementation; Phase 1 proceeds ([14.1b](14-roadmap-and-gates.md)).
- Orchestration target: the Windows 11 host `Alemnesh` (192.168.1.128, SSH alias `privatefleet`) with Docker Desktop (verified: Docker Desktop 4.95.0, engine 29.8.2, WSL2 backend); all containers and demo deployments orchestrate there over SSH ([15.3](15-infrastructure-and-deployment.md)).
- Phase 1 implementation begins from baseline `26f34b3`.

### v1.7 - environment baseline & quirks (2026-10-27)
- Environment baseline established (repo hygiene only, zero product code):
  - `402e877` - freeze approved documentation package as build baseline (41 files, branch `main`)
  - `d0f4c5a` - pin pnpm via `packageManager` and declare workspace root
  - `0209d77` - add CI skeleton gated on Phase 1 (GitHub run `40562480438`, success)
  - Remote: https://github.com/codeelias/privatefleet (private)
- pnpm **12.15.0**: verified to exist on the npm registry (`npm view pnpm@12.15.0 version` -> `12.15.0`); pinned in `package.json` `packageManager`. CI installs from the pin.
- **Corepack fallback (this Windows host):** `corepack enable` fails with EPERM writing shims into `C:\Program Files\nodejs` without admin elevation. Fallback: `npm install -g pnpm@12.15.0`. pnpm lives in `%APPDATA%\npm`, which is on the user PATH registry entry; if a shell does not resolve `pnpm`, append that directory to PATH. CI is unaffected.
- **SSH deployment target discovery:** the host at `192.168.1.128` is a **Windows** machine (hostname `Alemnesh`, user `deploy`, port 22) - not the Linux VPS assumed by [15.3](15-infrastructure-and-deployment.md). The authorized key is `~/.ssh/deploy_auto_ed25519` (automation key; the interactive `id_ed25519`/`id_rsa` are not authorized). A `Host privatefleet` alias was added to `~/.ssh/config`; the stale Host blocks mapping ports 2222/4096 remain there for the owner to remove. **Retarget-to-Linux vs Windows-deploy-variant is an OPEN roadmap decision deferred to Phase 1 - not resolved here.**

### v1.5 - formally approved & frozen (2026-10-27)
- Formal sign-off recorded: all 11 ADRs flipped to `accepted`; all 21 open decisions approved ([open-decisions.md](open-decisions.md) approval record).
- Q1 resolved: driver theme = **light**; the three Figma driver frames (5:4, 5:49, 5:91) are updated in Figma before any driver-screen code ([figma/ui-ux-handoff.md](figma/ui-ux-handoff.md) Section 12).
- Phase 0 directive adopted: name a design partner, run the 120-second pitch from Figma (not code), obtain an explicit yes - **before** any Phase 1 code ([14.1](14-roadmap-and-gates.md)).
- Housekeeping: Figma extraction token must be revoked by the account owner.

### v1.4 - UI/UX engineering handoff integrated
- Integrated the user-provided handoff as [figma/ui-ux-handoff.md](figma/ui-ux-handoff.md): design intent (honesty rules as design law), dispatcher/driver/portal tokens, screen contracts, client-event mapping onto the canonical catalog, the five-step ETA cascade, TenantTheme type, responsive rules, accessibility/error-state rules, React structure mapping onto the monorepo, implementation-sequence -> phase mapping, and the 11-item acceptance checklist.
- Added a reconciliation section and three open questions for sign-off (driver theme light-vs-dark, portal primary fallback, Phase 1 go-ahead).

### v1.3 - Figma design system integrated
- Extracted the Figma master design (`fnFeIyZr87XvelShaqyIVz`, version `2415061949869325185`) via the REST API into [figma/design-extract.md](figma/design-extract.md): color/type/spacing/radius tokens, per-screen content for all 9 frames (5 dispatcher, 3 driver, 1 portal), and normative UI micro-copy.
- Recorded the deltas the design introduces: concrete token set, "Jobs & Work Orders" supporting screen, canonical screen dimensions (1440 x 940 dispatcher, 390 x 844 driver, light 1440 x 940 portal), and notification configuration rules.
- Design references in [README.md](README.md) and [05.3](05-web-app-architecture.md) now point to the Figma design as the primary source; raw API artifacts kept in `.figma/` for re-extraction.

### v1.2 - commercial close & revenue layer
- Added [01.3b](01-vision-and-principles.md) - the white-label revenue multiplier: branding token set (no tenant CSS/JS injection), white-label notification templates, custom-domain routing.
- Added [05.3b](05-web-app-architecture.md) - the premium customer portal: pizza-tracker timeline, opt-in driver identity, POD vault, "Preview as Customer", white-label notifications; 1.5 s mobile load budget in [05.8](05-web-app-architecture.md).
- Added [14.2c](14-roadmap-and-gates.md) - the 48-hour close strategy: ROI leave-behind PDF, branded prospect sandbox, pilot contract framing.
- Added [12.6b](12-testing-and-quality.md) - context-aware seed data: `seed-courier.json` / `seed-medical.json`, region anchors, synthetic medical personas.
- Added D3-D5 to [open-decisions.md](open-decisions.md) (sign-off list now 21 items).
- Consistency wiring: opt-in identity fields on the public tracking endpoint ([11.4](11-security-and-compliance.md)); prospect sandboxes in [15.3](15-infrastructure-and-deployment.md); demo module catalog updated in [04.2](04-backend-architecture.md).

### v1.1 - emotional & sales layer
- Added [01.1b](01-vision-and-principles.md) emotional ROI mapping; [05.1b](05-web-app-architecture.md) Calm Command Center with responsive tiers and motion discipline; [06.1b](06-driver-app-architecture.md) driver co-pilot rules; [14.2b](14-roadmap-and-gates.md) theatrical 120-second script with honesty rule; [ADR-0011](adr/0011-empathetic-error-handling.md); D1-D2 in [open-decisions.md](open-decisions.md).
- Added demo resilience (local hardware, no venue-WiFi dependency), `prefers-reduced-motion` support, interaction/touch budget rows, slide-to-confirm E2E assertion, `uiMessage` in the error envelope ([04.4](04-backend-architecture.md)) and DoD ([13.3](13-development-methodology.md)).

### v1.0 - initial package
- 16 numbered documents, 10 ADRs, sign-off sections A/B/C (14 items).

## Verification record

Checks run on every version (results captured at each audit):

| Check | Latest result |
|-------|---------------|
| Internal file links resolve | 342/342 |
| Heading anchors resolve (GitHub slug algorithm) | 8/8 |
| Placeholder sweep (TODO/TBD/FIXME/lorem) | 0 found |
| Heading uniqueness per document | OK |
| Terminology (Honey Pot, US spelling) | consistent |
| Workspace contains application code | no - `docs/` + `screenshot/` only |

### Re-runnable checks (PowerShell, from repo root)

File links:

```powershell
$root = 'C:\privatefleet\docs'
$broken = @(); $checked = 0
Get-ChildItem -Recurse $root -Filter *.md | ForEach-Object {
  $content = Get-Content -Raw $_.FullName
  foreach ($m in [regex]::Matches($content, '\]\(([^)#\s<>]+)\)')) {
    $t = $m.Groups[1].Value
    if ($t -match '^https?://' -or $t -match '^/') { continue }
    $checked++
    if (-not (Test-Path -LiteralPath (Join-Path $_.DirectoryName $t))) { $broken += "$($_.Name) -> $t" }
  }
}
"checked: $checked  broken: $($broken.Count)"; $broken
```

Placeholder sweep:

```powershell
Get-ChildItem -Recurse 'C:\privatefleet\docs' -Filter *.md |
  Select-String -Pattern '(?i)todo|fixme|tbd|lorem' | Select-Object Path, LineNumber, Line
```

*(Anchor verification re-uses the heading-slug script recorded in the round-2 audit; it is reproduced in the next package revision if the checks migrate into CI.)*























