# ADR-0008 - Outbox for business events; telemetry fast path

**Status:** accepted (2026-10-27)

## Context
Two different event classes exist: business state changes (must never be lost) and GPS telemetry (high frequency, recoverable from the last snapshot). The blueprints route everything through an outbox; that adds latency and churn to the highest-volume path without improving correctness.

## Decision
- **Business events:** transactional outbox (`outbox_events` written in the same transaction as the state change), drained by a `FOR UPDATE SKIP LOCKED` publisher, delivered at-least-once, deduplicated by `eventId` ([09.3](../09-realtime-tracking.md)).
- **Telemetry** (`vehicle.position`): emitted directly to socket rooms after commit, at-most-once, coalesced <=1 Hz; clients recover via the snapshot endpoint ([09.7](../09-realtime-tracking.md)).

## Consequences
- GPS pings never bottleneck the outbox; business correctness never depends on socket delivery.
- The publisher starts in-process and extracts later without schema changes - the table is the contract.
- Consumers must dedupe business events; the web/driver clients implement this once in `shared/realtime`.

## Alternatives considered
- **All events through outbox (blueprint original):** uniform but wasteful for telemetry and slower for the demo's 500 ms budget; rejected for telemetry.
- **Socket as source of truth:** rejected outright - durability rules ([09.1](../09-realtime-tracking.md)).





