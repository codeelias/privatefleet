# ADR-0002 - Modular monolith over microservices

**Status:** accepted (2026-10-27)

## Context
The blueprint sources discussed microservice-style splits (optimization service, event workers) but the team size is 1-2 people, the tenant count starts at 1, and the demo must be built in weeks.

## Decision
One deployable API divided into vertical modules (identity, fleet, jobs, dispatch, tracking, optimization, alerts, pod, customer-tracking, tenancy) with enforced import boundaries ([04](../04-backend-architecture.md)). Modules own their routes, services, repos, events, and tests.

## Consequences
- One transaction can span a module's whole workflow - the outbox pattern stays simple and correct without distributed transactions.
- Modules remain individually testable and extractable: repo interfaces, public query interfaces, and events are the seams. Extraction later is mechanical, not architectural.
- OSRM/VROOM remain separate containers because they are separate engines with different runtime profiles, not because the API is microservices.
- Trade-off: in-process fan-out means one noisy module can affect the process; mitigated by module discipline and observability.

## Alternatives considered
- **Microservices now:** operational and coordination cost far exceeds value at 1-2 engineers and one tenant; rejected (revisit with metrics).
- **Layered monolith (controllers/services/repos by layer across the app):** modules become harder to test and extract; rejected.



