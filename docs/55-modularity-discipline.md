# 55 - Modularity discipline (governing rule)

Adopted 2026-11-06 by explicit owner instruction. This document governs every
code change from now on. If a change cannot satisfy it, the change is split or
deferred, never forced.

## The rule

> One change = one module. A change must never silently affect another module.
> When a change must cross a module boundary, the crossing is an explicit,
> documented decision, reviewed the same way as the code itself.

## Module map (current)

| Module | Boundary files | Owns |
|---|---|---|
| contracts | `packages/contracts/src/*` | DTO schemas, event envelope, shared vocab |
| db | `apps/api/drizzle/*`, `src/db/*` | schema, migrations, RLS, journal |
| auth | `src/modules/auth/*` | sessions, guards, rate limits |
| fleet | `src/modules/fleet/*` | jobs, stops, commands, policies, gates, timeline |
| optimization | `src/modules/optimization/*` | proposals, publish, supersede, close |
| routing | `src/modules/routing/*` | OSRM/VROOM adapters, plan math |
| tracking | `src/modules/tracking/*` | telemetry ingest, route progress, public tracking |
| driver | `src/modules/driver/*` | driver-scoped read feeds |
| reports | `src/modules/reports/*` | aggregations |
| app shell | `src/app.ts`, `src/server.ts` | assembly, error registry, hooks |
| native | `apps/driver-native/.../nativeapp/*` | one pure class per behaviour (see StationaryGate) |
| web | `apps/web/src/*` | dispatcher/customer UI, api-client |

## Allowed integration points (documented crossings)

1. **Error registry** (`app.ts` ERROR_MAP): modules throw typed codes
   (FleetError etc.); only the registry maps codes to HTTP. Adding a code =
   one union entry + one registry entry, both in the same commit.
2. **Contracts**: cross-module payloads go through `packages/contracts`
   schemas. Never ad-hoc shapes between modules.
3. **Outbox bus**: modules publish envelopes; subscribers live in their own
   module. A publisher never knows its subscribers.
4. **DB**: modules may only touch tables they own. Shared tables (vehicles,
   location_points) are read-only from consumer modules.
5. **Migrations**: schema changes are their own commit; the journal entry is
   part of that commit. Code never ships ahead of its migration.

## Change-scope audit (required before every commit)

- [ ] Which ONE module does this change belong to? (state it in the commit)
- [ ] Crossings used: ERROR_MAP? contracts? outbox? migration? (list them)
- [ ] No file outside the module + declared crossings was touched.
- [ ] Pure logic is in its own file with unit tests (no DB, no HTTP).
- [ ] Behaviour is off by default when it is new policy (radius NULL, warn).
- [ ] Tests: module unit tests + at most one integration test per crossing.
- [ ] Gate (typecheck + unit + integration + verify script) is green.
- [ ] Deploy is ONE deploy; live verification follows; rollback = revert commit.
- [ ] Web deploys sync the WHOLE dist via `scripts/deploy-web.ps1` - never
      per-file copies (partial dist = MIME errors on the dispatcher).
- [ ] After every file copy to the host: verify the file EXISTS remotely
      (dir/list) BEFORE restarting the service. A missing new module = API
      502. scp failures must never be swallowed.

## Reference implementations

- `StationaryGate.java` + `StationaryGateTest.java`: one pure class, one
  behaviour, fully unit-tested, no Android framework deps.
- `fleet/completion-gate.ts`: pure decision function (policy + fix + stop ->
  decision) unit-tested without a database; the DB-facing runner stays thin.

## Consequences

- No "quick fixes" across modules in the same commit.
- If a change threatens another module, it returns to investigation.
- Every commit message names the module and its crossings, e.g.:
  `feat(fleet): completion gate - crossing: ERROR_MAP, migration 0020`.
