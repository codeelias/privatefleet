# ADR-0011 - Empathetic Error Handling

**Status:** accepted (2026-10-27)

## Context
Standard HTTP errors (`409`, `422`, `500`) mean nothing to a stressed dispatcher or a driver on the road. If the software fails, it must fail gracefully and explain *what to do next* - not leak internal identifiers and not blame the user. Error handling is part of the emotional ROI ([01.1b](../01-vision-and-principles.md)): a graceful failure builds the trust that justifies the licence fee.

## Decision
Raw API errors are never surfaced in the UI. Every `AppError` in the API carries a `uiMessage` field (camelCase, per the contracts convention in [ADR-0003](0003-contracts-first.md)): human-readable, non-technical, and ending in a concrete next step. Examples:

| Instead of | The user sees |
|------------|---------------|
| `409 Conflict: JOB_VERSION_MISMATCH` | "Wait - this job was just updated on a phone. Reload to see the latest progress." |
| `500 Internal Server Error` | "Something went wrong on our side. Your change is safe - retry in a moment." |
| `422 location out of range` | "That location looks outside the service area. Check the address or create an exception." |

Technical detail (`code`, `instance`, `detail`) stays in the machine-readable problem+json envelope ([04.4](../04-backend-architecture.md)) for logs and support - it is never shown to end users.

## Consequences
- Backend developers must write customer-facing copy for every new error state; error copy is a deliverable reviewed in the PR like any other copy ([13.3](../13-development-methodology.md) DoD).
- Client apps render `error.uiMessage` directly - no client-side error-mapping tables to drift.
- A generic fallback message is the only permitted default for untranslated states; those are caught in review.
- Fewer support calls, and pilot-phase trust compounds with every graceful failure.

## Alternatives considered
- **Client-side error mapping:** duplicates copy logic in every client and drifts out of sync; rejected.
- **Raw errors to users:** fastest to build, but erodes trust exactly when it matters - conflicts, exceptions, dead zones; rejected.



