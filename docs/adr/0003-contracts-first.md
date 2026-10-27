# ADR-0003 - Contracts-first shared package (zod + TypeScript)

**Status:** accepted (2026-10-27)

## Context
Three clients (web, driver, future customer-facing site) consume one API. Type drift between them is the classic source of silent bugs in fleet products (wrong status enums, renamed fields).

## Decision
`@privatefleet/contracts` holds every cross-boundary shape - REST request/response schemas (zod), WebSocket event payloads (versioned with `schemaVersion`), domain DTOs, and error codes - as the single source of truth. The API validates against them (`fastify-type-provider-zod`); clients use inferred TypeScript types. No runtime logic lives in the package.

## Consequences
- A contract change breaks compilation everywhere it matters, before runtime.
- OpenAPI is generated from the API for tooling and snapshot-tested, not hand-maintained ([12.4](../12-testing-and-quality.md)).
- Discipline required: contracts must stay client-shaped (no leaking column names or internal errors).
- Trade-off: contracts changes require coordinated bumps across packages (changesets handle this).

## Alternatives considered
- **OpenAPI-first with codegen:** heavier toolchain, codegen friction in a monorepo; rejected.
- **Copy-paste types per client:** drift is guaranteed; rejected.
- **tRPC:** attractive for web, but constrains the driver app and public endpoints to an HTTP transport we don't want to commit to; REST + sockets remain the contract surface.



