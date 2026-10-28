# ADR-0005 - Drizzle ORM + raw SQL for PostGIS

**Status:** accepted (2026-10-27)

## Context
The schema is PostGIS-heavy (geography types, GiST indexes, `ST_*` predicates, RLS with transaction-local settings). Data access must be type-safe, migration-friendly, and must not fight spatial SQL.

## Decision
Drizzle ORM: TypeScript schemas as the migration source (`drizzle-kit generate` -> committed SQL), type-safe query builder for CRUD, and raw SQL templates for spatial predicates and hot-path statements ([07](../07-database-design.md)). RLS and roles live in plain SQL migrations.

## Consequences
- No engine binary (unlike Prisma), no codegen step, small surface.
- Spatial work stays in explicit, reviewable SQL where PostGIS expertise applies.
- Trade-off: fewer batteries than Prisma (no studio/prisma-client ergonomics); acceptable at this scale.

## Alternatives considered
- **Prisma:** excellent DX but heavy; PostGIS/geography and RLS flow through `Unsupported`/raw SQL anyway; rejected.
- **Kysely:** fine query builder, but migrations are hand-written and schema isn't a typed artifact; Drizzle's schema->migration pipeline wins.
- **Raw `pg` only:** lightest, but loses type safety across the many CRUD paths; rejected.




