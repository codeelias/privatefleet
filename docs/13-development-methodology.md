# 13 - Development Methodology

**Status:** Draft v1 - for approval.
**Applies to:** all contributors, all phases.

The methodology optimizes for: small reversible changes, reviewable history, decisions that outlive their authors, and no ceremony that doesn't pay for itself.

## 13.1 Branching & workflow

- **Trunk-based development.** `main` is always deployable. Short-lived branches: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
- Direct commits to `main` are allowed only for docs/typos; everything else goes through a PR.
- PR size target <= 400 changed lines; larger work is split by vertical slice, not by layer. A PR that changes behaviour **and** its documentation in one diff is the norm ([docs-as-code](README.md)).

## 13.2 Commits & PRs

- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), enforced by commitlint in CI; the PR title becomes the squash-commit message.
- PR template requires:
  1. What & why (user-visible outcome).
  2. Contract changes (API/event/schema diffs) - explicit.
  3. Database migrations: up + down + rollback plan ([07.7](07-database-design.md)).
  4. Tests added, including which hardening scenario this touches.
  5. Demo impact: does the 120-second flow change? E2E updated?
  6. Docs/ADR updated in this PR.
  7. Docs are ASCII-only (no em dashes, arrows, smart quotes, or box-drawing characters; see the v1.6 changelog entry in [CHANGELOG.md](CHANGELOG.md)).
- Review: CI green + one approval required; two approvals for security, RLS, schema, or state-machine changes. No self-merges.
- Review checklist (abbreviated in the template): correctness of transitions; idempotency; tenant scoping on every query; error typing; observability fields; dependency budget; performance budget.

## 13.3 Definition of Done

A change is done when:

- Strict typecheck, lint, unit, integration (where applicable), and E2E pass.
- New edge cases from [12.3](12-testing-and-quality.md) are covered or explicitly N/A.
- Migrations are reversible and the rollback plan is stated.
- Docs and (if significant) an ADR are updated in the same PR.
- Logging/metrics fields exist for the new path.
- New error states ship their `uiMessage` copy ([ADR-0011](adr/0011-empathetic-error-handling.md)).
- The demo scenarios still pass - or their E2E was updated deliberately.

## 13.4 Decisions: ADR process

- Any architecturally significant decision (new dependency class, cross-module pattern, data strategy, deployment change) is recorded as an ADR in `docs/adr/` using the [template](adr/README.md).
- Statuses: `proposed` (in PR) -> `accepted` / `superseded` (with a link to the replacing ADR).
- A code change contradicting an accepted ADR must first supersede it - the review blocks on it.
- Larger cross-cutting designs get a lightweight RFC in `docs/rfc/` (same template family, marked `adopted`/`rejected` after review).

## 13.5 Releases & versioning

- Changesets manage per-package versions and changelogs (`pnpm changeset`); semver per package: `contracts` and `api` are the compatibility-sensitive ones.
- Release = a changeset PR -> version PR -> tag -> deploy `demo` (always) and `staging`/`prod` (per roadmap phase). Web and driver ship independently of API releases; contract breaking changes trigger coordinated bumps.

## 13.6 Cadence & ceremonies (kept minimal)

- **Weekly demo checkpoint** against the current phase gate ([14](14-roadmap-and-gates.md)) - the standing agenda is "show the working slice, list the blockers".
- No sprint theatre; milestones are the phase gates, work is tracked on a simple board (GitHub Projects).
- Retrospectives happen at gate completion (or on a real incident), not on a calendar.
- Incidents: a short written record (what, impact, fix, prevention) committed under `docs/incidents/`; prevention items become tests or ADRs.
- Pairing is required for state machines, schema migrations, and security-sensitive code - these are where silent errors live.

## 13.7 Developer environment

- Windows (primary, this repo) with WSL2/Docker Desktop for the Compose stack; Node pinned via `.nvmrc` (fnm/nvm-windows).
- `pnpm dev` must bring the whole demo up with one command; if it doesn't, that's a bug.
- README-level "new developer in 15 minutes" instruction is a phase-gate requirement for Phase 1.




