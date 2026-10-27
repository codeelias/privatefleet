# 03 - Monorepo Layout

**Status:** Draft v1 - for approval.
**Decisions:** [ADR-0001](adr/0001-monorepo-pnpm-turborepo.md) (monorepo), [ADR-0002](adr/0002-modular-monolith.md) (modular monolith), [ADR-0003](adr/0003-contracts-first.md) (contracts package).

## 3.1 Workspace tree

```
privatefleet/
+- apps/
|  +- api/                      # @privatefleet/api - modular monolith + outbox publisher
|  |  +- src/                   #   structure in docs/04-backend-architecture.md
|  +- web/                      # @privatefleet/web - dispatcher dashboard
|  |  +- src/                   #   structure in docs/05-web-app-architecture.md
|  +- driver/                   # @privatefleet/driver - Expo driver app
|     +- app/                   #   structure in docs/06-driver-app-architecture.md
+- packages/
|  +- contracts/                # @privatefleet/contracts - zod schemas + inferred types
|  |  +- src/
|  |     +- domain/             #   DTOs: job, stop, route, driver, vehicle, ...
|  |     +- api/                #   REST request/response schemas per module
|  |     +- events/             #   outbox/socket event payloads (versioned)
|  |     +- errors/             #   app error codes
|  +- eslint-config/            # @privatefleet/eslint-config - shared flat config
|  +- tsconfig/                 # @privatefleet/tsconfig - shared TS bases
+- infra/
|  +- compose.dev.yml           # PostGIS, MinIO, OSRM, VROOM, Caddy
|  +- compose.staging.yml
|  +- caddy/                    # Caddyfile templates (demo/staging)
+- docs/
|  +- adr/
|  +- rfc/                      # (created on demand) lightweight RFCs
+- .github/workflows/           # CI: lint -> typecheck -> test -> build -> e2e
+- pnpm-workspace.yaml
+- turbo.json
+- package.json                 # root scripts; packageManager pinned (corepack)
+- .nvmrc                       # Node LTS (22)
+- README.md                    # added with the scaffold, points at docs/
```

## 3.2 Package responsibilities

| Package | Owns | Never owns |
|---------|------|------------|
| `contracts` | All cross-boundary shapes: domain DTOs, REST schemas, event payloads, error codes. | Runtime logic, HTTP, DB code. Zero dependencies. |
| `eslint-config`, `tsconfig` | Shared lint/type rules and TS bases. | Application code. |
| `api` | Domain logic, persistence, realtime, optimization adapters. | UI. |
| `web` | Dispatcher dashboard. | Backend logic; talks to API only through contracts. |
| `driver` | Driver execution UI and offline queue. | Backend logic; same API as web. |

## 3.3 Dependency rules (enforced, not aspirational)

- `apps/*` may depend on `packages/*`, never on each other.
- `packages/*` may depend on `packages/*`; `contracts` depends on nothing.
- No `src`-internal imports across apps (no reaching into another app's source tree).
- Enforced by: ESLint `import/no-restricted-paths` + `import/no-internal-modules` in `@privatefleet/eslint-config`, a `madge` cycle check in CI, and Turborepo's task graph (`dependsOn`).

Consequence: the only legal way for web and driver to talk to the API is through the published contract types and endpoints - which keeps the seam honest.

## 3.4 Tooling

| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm (workspaces) | Package management | Pinned via `packageManager` + corepack. |
| Turborepo | Task orchestration & caching | `build`, `lint`, `typecheck`, `test` tasks; remote cache optional later. |
| TypeScript | All code; `strict: true` **plus** `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax` | Bases in `@privatefleet/tsconfig`; see [12](12-testing-and-quality.md). |
| ESLint (flat) + Prettier | Static quality + formatting | Shared config package; import-boundary rules. |
| lefthook | Local git hooks (format/lint on pre-commit) | CI enforces the same gates; hooks are convenience, not authority. |
| Changesets | Changelogs & per-package versions | See [13](13-development-methodology.md). |
| commitlint | Conventional commit enforcement | CI gate. |
| Node | `22` LTS pinned in `.nvmrc` | Windows dev machines use fnm/nvm-windows; lockfile decides exact patch. |

## 3.5 Root scripts (conventions)

```
pnpm dev              # turbo dev: api (DEMO_MODE) + web (+ driver web when requested)
pnpm build            # typecheck + build all packages
pnpm lint             # eslint across workspaces
pnpm typecheck        # tsc --noEmit across workspaces
pnpm test             # unit + integration (unit by default; integration via pnpm test:int)
pnpm e2e              # Playwright against a DEMO_MODE boot (CI)
pnpm changeset        # changesets CLI
```

## 3.6 Adding a new backend module (recipe)

1. Create `apps/api/src/modules/<name>/` with the module skeleton from [04.2](04-backend-architecture.md).
2. Register the module in `apps/api/src/server.ts` (`buildApp()`).
3. Add/confirm contract schemas in `packages/contracts` - no raw shapes in handlers.
4. Add the module's tables to a new migration in the module's `repo/` (see [07.7](07-database-design.md)).
5. Add boundary rules to the ESLint config if the module has new allowed/forbidden imports.
6. Add unit + integration tests per [12](12-testing-and-quality.md); a new module without tests does not merge.
7. Update [04](04-backend-architecture.md)'s module table and, if the change is architecturally significant, add an ADR.

## 3.7 What we deliberately avoid

- **No code generation from OpenAPI in either direction.** The contracts package *is* the source of truth; OpenAPI is generated from Fastify+zod for documentation/tooling only (see [12.4](12-testing-and-quality.md)).
- **No shared UI package yet.** `web` and `driver` have different rendering targets; a `packages/ui` appears only when a third consumer (or the customer-facing tracking site as a separate app) proves the need.
- **No framework-agnostic "core" package.** The domain lives in the API; contracts carry shapes, not behaviour.




