# ADR-0007 - Demo = production API with in-memory repos + simulator

**Status:** accepted (2026-10-27)

## Context
The blueprint lineage debated "frontend-only demo shell with hardcoded JSON" (Qwen's version) vs "demo sharing the real data model" (final blueprint). Requirements: a multi-device demo (dispatcher screen + driver tablet in sync), instant scenario resets, and zero throwaway work.

## Decision
The Honey Pot runs the **real** web and driver apps against the **real** Fastify API with `DEMO_MODE=true`: in-memory repository implementations behind the same repo interfaces as Postgres, a seeded-scenario loader/reset endpoint, and a GPS simulator that calls the identical ingestion path. The seam lives server-side, not in the UI ([14.2](../14-roadmap-and-gates.md), [09.8](../09-realtime-tracking.md)).

## Consequences
- The demo exercises the production event pipeline (transaction -> outbox -> Socket.IO -> UI) from day one - the riskiest part of the product is de-risked before a single line of mock code.
- The UI contains no demo data or fake interactions; demo and production UIs are identical.
- Trade-off: more backend work in Phase 1 than a frontend mock - accepted because everything built is production code.
- Optimization results in the demo are seeded and labelled "simulated" unless live OSRM/VROOM containers are configured ([10.4](../10-optimization-integration.md)).

## Alternatives considered
- **Frontend-only mock (hardcoded JSON):** fastest, but cannot sync two devices, teaches nothing about the real pipeline, and is thrown away; rejected.
- **Separate mock server in another language/framework:** duplicate surface; rejected.




