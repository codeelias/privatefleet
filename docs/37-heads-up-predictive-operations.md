# 37 - Heads-Up predictive operations

Date: 2026-11-02  
Scope: Live Operations proactive risk layer.

## Why this is a differentiator

Most dispatch UIs tell the dispatcher what has already gone wrong. Heads-Up
shows what is about to go wrong, from the same authoritative fleet state, before
it becomes an exception.

It is deliberately **not** another exceptions list:

```text
Exceptions & Alerts = confirmed events requiring an audit trail
Heads-Up            = predicted risk that may still be prevented
```

## Risk model

Deterministic client-side model: `apps/web/src/features/heads-up/engine/heads-up.ts`.

### 1. Projected late stop

For each active route:

- project the vehicle's current fix onto the published route
- read the current leg and remaining leg duration
- compute the remaining planned duration to each pending job waypoint
- predict arrival as `now + remaining planned duration`
- compare with the customer window end, with a 5-minute buffer
- critical when >= 15 minutes late or the job is STAT
- otherwise warning

No traffic provider is used and no speed is invented. The UI explicitly says
"From live route progress and windows. Not a traffic forecast."

### 2. Unassigned window risk

- only unassigned jobs
- pickup window opens within 60 minutes, or is already overdue
- critical if overdue or STAT
- warning otherwise
- recommended action: assign a compliant vehicle before the window opens

### 3. Stale tracking

- vehicle `stale` or `locationStatus === "stale"`
- shows how many minutes since the last usable fix
- explicitly tells dispatch not to dispatch on the last-known pin

### 4. Off-route

- projected distance from the published line > 150 m
- only for a non-stale fix
- recommendation to confirm with the driver before refreshing the route

### 5. Assigned without a published route

- assigned or in-progress job
- driver has no active route record
- blocks a silent "assigned but cannot navigate" state

## UI

A compact strip above the live map:

```text
! HEADS UP   13 critical | 4 projected late | 1 stale GPS | 11 window risks
             1 route issue · B01-001 unassigned and overdue
             13 CRITICAL   4 WARNING   Review
```

Opening it shows a ranked panel, capped at eight visible items with an
"N more" control. The panel is non-modal and closes on Escape or the strip.

Every item has:

- severity
- evidence and timing
- recommended action
- Open assignment when a job is involved
- Follow vehicle when a driver is involved
- Open exceptions for the confirmed-event workflow

## Re-route from an off-route or late risk

Items with a driver offer **Re-route driver**: the single-driver live planner
starts from the vehicle's last fix and pending stops only, shows the revised
distance/duration, and publishes only after a separate confirmation with the
server's stale-version guard. After publishing the fleet query is invalidated.

## Customer update from a late risk

A projected-late item now has **Customer update**:

- creates a real job-scoped tracking token through the existing API
- builds a copyable message with the predicted arrival/window evidence and
  tracking URL
- the link can be opened directly or copied into the operator's existing
  customer channel
- no SMS/email provider is invented or charged
- the link is revocable from Customer Tracking

This is deliberately a manual send step: the system prepares the truth, the
dispatcher chooses the customer channel.

## Live result

At 12:00 on 2 November 2026, the production fleet produced:

```text
13 critical
4 warning
4 projected late
1 stale GPS
11 unassigned window risks
1 route issue
```

This is intentional: the fleet currently has 15 unassigned jobs with windows
that opened earlier in the day. The Heads-Up layer makes that backlog visible
before the customer calls.

## Why client-side

- state already arrives via the realtime fleet query
- no second source of truth
- deterministic and testable
- updates immediately with socket-driven fleet state
- no extra API round trip on every telemetry tick

The calculation is bounded by routes × pending waypoints (currently
3 × 30), and runs only when fleet state changes.

## Tests

`apps/web/src/features/heads-up/engine/heads-up.test.ts`:

- projected late stop
- no false late positive when the window is comfortably ahead
- unassigned window risk
- stale tracking
- off-route detection
- assigned without route

Playwright `map-camera.spec.ts` verifies the strip and panel in the demo live
screen.

## Honest limits

- ETA uses published leg duration, not live traffic, weather or historical
  travel time.
- It does not auto-reassign or auto-cancel.
- Unassigned risk is based on the pickup window opening, not a promised
  customer contact time.
- The panel shows the top eight; full lists are in the exceptions workflow.
- Customer update prepares a copyable message and tracking link; it does not send SMS/email itself.
- A real traffic provider would be a paid integration and must not be faked.

## Next differentiators

- Traffic-aware ETA with a visible data source and confidence.
- Customer-notification queue for predicted-late jobs.
- Driver workload balance risk (after a defensible capacity model exists).
- SLA trend by customer, not just per job.
