# ADR-0001 - Monorepo with pnpm workspaces + Turborepo

**Status:** accepted (2026-10-27)

## Context
Three deployables (API, web, driver app) share a domain vocabulary, contracts, and tooling. A single developer can realistically build this product; multiple repos would multiply configuration and drift while adding nothing.

## Decision
One pnpm-workspace monorepo: `apps/{api,web,driver}` + `packages/{contracts,eslint-config,tsconfig}` ([03](../03-monorepo-layout.md)). Turborepo orchestrates tasks and caching. Node pinned via `.nvmrc`.

## Consequences
- One PR can change a contract and both consumers atomically - the main reason this exists.
- Single lint/type/test configuration; CI caches well.
- Repo-wide lockfile; releases via changesets per package.
- Trade-off: repo-level tooling (turbo, changesets) is a small constant overhead; accepted.

## Alternatives considered
- **Polyrepo:** better isolation, but contract drift between API/web/driver would be a constant tax for a small team; rejected.
- **Nx:** more capable but heavier; Turborepo covers our task-graph needs.



