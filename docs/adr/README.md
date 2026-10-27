# Architecture Decision Records

Each record captures a significant, hard-to-reverse decision: context, decision, consequences, and alternatives considered. Statuses: `proposed` (open in a PR) -> `accepted` / `superseded`.

## Template

```markdown
# ADR-00NN - Short Title

**Status:** accepted (YYYY-MM-DD)  /  **Supersedes:** -  /  **Superseded by:** -

## Context
## Decision
## Consequences
## Alternatives considered
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm workspaces + Turborepo | accepted |
| [0002](0002-modular-monolith.md) | Modular monolith over microservices | accepted |
| [0003](0003-contracts-first.md) | Contracts-first shared package (zod + TypeScript) | accepted |
| [0004](0004-fastify.md) | Fastify for the API | accepted |
| [0005](0005-drizzle-postgis.md) | Drizzle ORM + raw SQL for PostGIS | accepted |
| [0006](0006-react-stack.md) | React web stack (Vite, TanStack, Zustand, Tailwind, MapLibre) | accepted |
| [0007](0007-demo-strategy.md) | Demo = production API with in-memory repos + simulator | accepted |
| [0008](0008-realtime-outbox.md) | Outbox for business events; telemetry fast path | accepted |
| [0009](0009-expo-driver-app.md) | Expo driver app from day one (web target for the demo) | accepted |
| [0010](0010-map-tiles.md) | Map tiles: OpenFreeMap initially | accepted |
| [0011](0011-empathetic-error-handling.md) | Empathetic error handling (`uiMessage` on every error) | accepted |

*Dates recorded as accepted on the date of your approval of this package; statuses flip to `accepted` at that point.*

## Rules

- A new ADR is required for: a new dependency class, a cross-module pattern, a data/deployment strategy, or any reversal of an existing record.
- PRs that contradict an accepted ADR are blocked until the ADR is superseded.
- Keep records short - context and consequences matter more than prose.



