# 12 - Testing & Quality

**Status:** Draft v1 - for approval.
**Related:** [03.4](03-monorepo-layout.md) (tooling), [08](08-domain-model-and-events.md) (what to test), [14](14-roadmap-and-gates.md) (gates).

## 12.1 Strategy

The demo scenarios and the hardening scenarios **are** the test suite. We write them as tests first-class, not as manual rituals.

| Layer | Tool | Scope | Examples |
|-------|------|-------|----------|
| Static | TS strict + ESLint (incl. import boundaries) + Prettier + commitlint | Every commit/PR | no `any`, no illegal cross-module imports, conventional commits |
| Unit | Vitest | Pure domain logic with in-memory repos | state-machine transitions, invariants, VROOM payload mapping, offline queue reducer, ETA math, formatting |
| Integration | Vitest + `buildApp()` + real Postgres (Compose) | Lifecycle + persistence + isolation | idempotent commands, RLS cross-tenant denial, outbox drain, ordering regression, publication conflicts |
| Contract | Snapshot tests on generated OpenAPI + zod event fixtures | API/WS shapes vs contracts package | web/driver clients compile against the exact shapes the API validates |
| E2E | Playwright vs `DEMO_MODE` boot | Full user journeys | the three demo scenarios + driver journey in a mobile viewport |

Coverage policy: >=80% line coverage on `modules/*/service` and `lib/` (where the logic lives); UI coverage is behavioural (E2E), not vanity percentages.

## 12.2 The demo scenarios as acceptance tests

| Scenario | E2E spec asserts |
|----------|------------------|
| Morning Rush | 8 unassigned jobs, 3 drivers render; prospect assigns and rebalances; timeline/map stay consistent; Optimize produces a labelled proposal. |
| Emergency | STAT job injected mid-route; drag-assign shows a human-readable impact preview; confirm commits; ETA cascade updates map + timeline; driver tablet receives the change. |
| Proof of Service | Driver marks stop complete via slide-to-confirm with signature (mobile viewport); dispatcher dashboard shows completed block + POD thumbnail; tracking preview shows delivered status. |

Plus the demo performance assertion: assignment drop -> committed visual update **< 500 ms** on the CI browser profile ([05.8](05-web-app-architecture.md)).

The handoff's 11-item acceptance checklist ([figma/ui-ux-handoff.md](figma/ui-ux-handoff.md) Section 10) is the Phase 1 exit checklist; every item maps to a test or budget above.

## 12.3 The hardening scenarios as integration tests

From the blueprint's engineering gate - each becomes an automated test, never a manual checklist:

1. Same driver command submitted twice -> one accepted, one identical replay (idempotency).
2. Older location point arrives after newer one -> current position never regresses.
3. DB commits but publisher fails -> outbox row retried and delivered after restart.
4. Dispatcher and driver change the same job concurrently -> one wins, other gets a typed 409 conflict.
5. Driver reconnects with conflicting offline actions -> conflict result, no silent overwrite.
6. Optimization proposal is stale or infeasible -> surfaced as such; approval rejected if conflicts exist.
7. Tracking token expired/revoked/used against another job -> denied, audited.
8. User probes another tenant's REST endpoints and socket rooms -> denied on all three isolation layers.
9. Backup restored into staging -> acceptance smoke passes (drill, monthly).

## 12.4 Contract tests

- Fastify + zod generate OpenAPI at build time; a snapshot test fails CI if the API surface changes without a matching contracts change.
- WebSocket event fixtures are validated against the contracts schemas in unit tests - every event the server emits has a typed example.
- This makes the contracts package the enforced single source of truth ([ADR-0003](adr/0003-contracts-first.md)).

## 12.5 CI pipeline (GitHub Actions)

```
lint -> typecheck -> unit -> integration (compose Postgres) -> build -> e2e (Playwright)
```

- Cached by Turborepo; merges blocked on any failure; e2e runs against a production-style `DEMO_MODE` boot.
- `commitlint` + PR title checks on every PR; dependency audit runs daily.
- Local pre-commit hooks (lefthook) mirror the cheap gates; CI is the authority.

## 12.6 Test data & determinism

- Seeded fixtures only (the demo scenarios double as fixtures); no random faker data in assertions.
- Time is injectable (clock abstraction) in all domain logic tests; no flaky "now" assertions.
- Integration tests create and tear down their own tenant(s) in a dedicated test database.

## 12.6b Context-aware seed data

The Honey Pot fails if the data doesn't feel real to the specific prospect. The demo module's seeds are data-driven and parameterized, never hardcoded:

- **Vertical-specific seeds** (`modules/demo` loads one per sandbox):
  - `seed-courier.json` - "Amazon return", "Legal documents", "Pharmacy delivery".
  - `seed-medical.json` - "Patient transfer - dialysis", "STAT specimen to lab", "Hospital discharge".
  - All medical seeds use **synthetic personas only** - no real patient data, per the compliance gate ([11.6](11-security-and-compliance.md)).
- **Geographic relevance.** Seed coordinates and polylines are generated from a city/region anchor parameter - a London courier sees London streets, a Manchester operator sees Manchester. Region is a seed parameter, never code ([14.2](14-roadmap-and-gates.md) scenario reset flow).
- Seeds double as the deterministic E2E fixtures ([12.2](12-testing-and-quality.md)); a new seed ships with its scenario test.

## 12.7 Performance & budgets

- Budgets from [05.8](05-web-app-architecture.md) are CI-enforced where automatable (bundle size, E2E timing on assignment commit).
- The full 120-second demo remains a rehearsed, gated human check at each phase exit ([14](14-roadmap-and-gates.md)) - automation guards regressions; the rehearsal guards the experience.

## 12.8 Viewport-guarded E2E tests (not silently excluded)

Playwright runs two projects: `dispatcher` (1440x900) and `driver`
(iPhone 13 size). The full suite therefore reports skips for tests that
only make sense on one viewport:

| Skipped in | Test | Reason |
|---|---|---|
| driver | Morning Rush assignment flow | dispatcher layout is desktop-only |
| driver | Emergency drag-assignment flow | dispatcher layout is desktop-only |
| driver | Route consistency / movement / selection | dispatcher map layout is desktop-only |
| dispatcher | Proof of Service driver flow | driver app layout is mobile-size only |

These are `test.skip(...)` guards inside each test, evaluated per project,
not excluded files: `pnpm e2e` runs the union, so CI cannot drop a skipped
test silently. Expected suite totals are `passed + skipped` per project and
are reviewed at each phase gate; a skip on the dispatcher project is treated
as a failure to investigate because dispatcher tests must run at desktop
size.





