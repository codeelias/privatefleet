# ADR-0004 - Fastify for the API

**Status:** accepted (2026-10-27)

## Context
The blueprints oscillated between Express and Fastify. Requirements: schema-first validation, WebSocket coexistence, per-request tenant context, and low overhead for high-frequency GPS ingestion.

## Decision
Fastify with `fastify-type-provider-zod`; Socket.IO attached to the HTTP server ([04](../04-backend-architecture.md)).

## Consequences
- Request/response validation shares the contracts schemas directly.
- Fastify's plugin encapsulation maps cleanly onto module registration.
- Trade-off: smaller middleware ecosystem than Express; our needs (auth, rate-limit, cors, sensible defaults) are all first-party or stable plugins.

## Alternatives considered
- **Express:** larger ecosystem, but no built-in schema validation and slower; the blueprint's own V2 moved to Fastify - agreed.
- **Hono / Elysia:** excellent but newer and less battle-tested for long-lived multi-year products; rejected.



