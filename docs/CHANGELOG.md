# Documentation Changelog & Verification Record

Records what changed in the documentation package and the automated checks that keep it trustworthy. Re-run the checks after any PR that touches `docs/` - the docs-as-code rule ([13](13-development-methodology.md)) applies to this file too.

## Version history

### v1.6 - ASCII hardening (2026-10-27)
- A background process on this machine repeatedly re-saved markdown files through a legacy codepage, corrupting non-ASCII characters (em dashes, arrows, box drawing, check marks) mid-session. All files were repaired, then the entire package was converted to ASCII-only. ASCII is invariant under any codepage round-trip, so the package is now immune to this failure class.
- Substitutions: em/en dash -> '-', arrow -> '->', bullet -> '*', middot -> ' / ', multiplication -> 'x', check marks -> '[x]', circle -> 'o', '>='/'<=', ellipsis -> '...', section sign -> 'Section ', pound sign -> 'GBP ', box drawing -> '+', '-', '|', 'v', '>'.
- New standing rule (recorded in [13.2](13-development-methodology.md)): all documentation is ASCII-only from now on.

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




