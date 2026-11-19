# CV pitch — PrivateFleet (5-part honest structure)

## The problem

London specialist B2B courier operators run scheduled and urgent deliveries
with strict time windows and evidence-sensitive handovers. When something
goes wrong — a missed window, a "delivered but not received" dispute — the
operator usually cannot say which customer commitment was threatened, what
was done about it, or prove completion. Missing proof-of-delivery directly
costs money (unpaid invoices), and existing tools track vehicles and stops
but not commitments, responses, or evidence chains.

## What you did

- Wrote the frozen product definition: "Every delivery has a commitment.
  Every exception gets an accountable response. Every completion has
  evidence." — and held every feature to it.
- Chose the architecture: multi-tenant PostgreSQL/PostGIS with row-level
  security, transactional outbox, append-only event history, database-
  enforced idempotency, derived (never stored) outcomes, an offline-first
  native Android driver app, OSRM/VROOM routing, LAN-first deployment.
- Ran the programme: P0 (pin-tap identity, backup/restore drills, two-site
  encrypted backups) and P1 (Commitment Risk Engine, exception episodes,
  typed response actions, truthful outcomes, printable evidence reports,
  a deterministic 120-second demonstration).

## How AI helped

- An agentic coding tool generated most of the code: Fastify/TypeScript API,
  React dispatcher, native Android (Java) driver app, SQL migrations,
  unit/integration tests, PDF report generation, and deployment scripts.
- It drafted documentation, the synthetic demo scenario, and the negative
  acceptance tests — always under your review.
- It debugged failures you both hit (GPS service crash loops, geofence
  bugs, race conditions) and explored alternative designs for the risk
  engine and the exception lifecycle.

## What you checked and owned

- Product direction, the acceptance criteria, and every review verdict.
- Rejected AI overclaims repeatedly: no fabricated delivery-time verdicts
  (timing stays "unverified" without independent evidence), no "sent" email
  claims without SMTP acceptance, no synthetic data touching production.
- Caught real defects in AI output (a permission-ordering crash that
  silently stopped GPS, wrong idempotency semantics, a demo that initially
  misused the assignment workflow) and demanded fixes with evidence.
- Owned gates, deployment, and live verification: ran the test suites,
  deployed to the LAN host, checked database state before/after, and kept
  honest statuses (implemented / tested / deployed / live-verified).

## The result

- P0 acceptance (tap identity, restore drills, off-site replication) and
  P1 Commitment Recovery v1 accepted by review; 200+ automated tests green
  (201 API + 53 web at close).
- A reproducible 120-second end-to-end demonstration: commitment → detected
  risk → dispatcher response → threat resolution → integrity-checked
  evidence report, on production hardware with production data untouched.
- Documented, honest limitations instead of hype (no driver-reassignment
  of assigned jobs yet; no commercial validation — a deliberate
  "not established", not a hidden weakness).
- Personally: learned to run AI-assisted development the way an operator
  runs a fleet — evidence over assertion, honest statuses, and never
  letting a tool's output ship unverified.

## Disclosure sentence (use verbatim where relevant)

> Implementation was AI-assisted: an agentic coding tool wrote most of the
> code under my direction; I contributed product definition, architecture
> decisions, acceptance testing, data-integrity rules, and deployment.

## Same 5-part template for your other projects

1. **The problem:** what was the project meant to solve?
2. **What you did:** the technologies and the decisions you made.
3. **How AI helped:** where you used it (boilerplate, tests, debugging,
   exploring approaches).
4. **What you checked and owned:** how you reviewed, tested, and corrected
   the AI's output.
5. **The result:** something concrete — time saved, features shipped,
   lessons learned.

Rules: only real roles, real tools, real numbers; no customers/revenue
claims for pre-commercial work; AI use disclosed, never hidden and never
inflated.
