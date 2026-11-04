# 52 - Differentiators: what makes PrivateFleet stand out

Date: 2026-11-04
Status: in progress (slice plan)

## Selection logic

Chosen against: (a) value to customers and fleet operators, (b) feasibility on
the existing honest stack, (c) verifiability. Deferred items are listed so the
decision is transparent.

## S1 - Customer live progress (done, live-verified)

Status: shipped. Public /track page shows "N stops before you / You are next"
and a live ~ETA projected from the vehicle position onto the route. Verified
against production: stopsAway=0, etaMinutes=1, confidence=high, on_time.

## S1b (original plan text) - Customer live progress ("driver is N stops away")

The public tracking page gets a live progress line: stops remaining before the
customer's delivery and an ETA in minutes, computed from the driver's live
position projected onto the published route geometry. This is the single
feature customers remember from consumer delivery apps, and no mainstream B2B
courier tool exposes it.

- API: extend the public tracking payload with
  `progress: { stopsAway, etaMinutes }`.
- Pure math (server-side, unit-tested): project vehicle position onto route
  polyline, count incomplete stops before the customer's stop, remaining
  distance / rolling speed -> ETA.

## S2 - Delivery confidence score (done, live-verified)

Status: shipped. Every terminal stop in fleet state carries a 0-100 score
from verifiable signals only (photo 30, signature 30, GPS-at-stop 25, window
15; structured failures score 0). Dispatcher stop cards show the badge and
factor breakdown. Verified live: 57/57 terminal stops scored on production.

## S2b (original plan text) - Delivery confidence score (automatic, evidence-based)

Every completed stop is scored 0-100 from verifiable signals only:
photo evidence present, recipient signature present, completion GPS stamp
within tolerance of the stop, completed inside the time window, no failure
code. Dispatchers see the score + contributing factors; no invented inputs.

- API: `deliveryConfidence` on job/stop detail (derived at read time).
- Web: badge on the dispatch board and job detail with factor breakdown.

## S3 - Driver shift performance (native) - next slice

Planned next: "My shift" stats in the driver app from data the driver
already produces: stops completed, on-time rate, photos/signatures taken,
distance driven. No new sensors, no invented numbers.

## Deferred (documented, not started)

- Voice navigation prompts (needs TTS QA + driving-safety review)
- Driver earnings/bonus engine (commercial policy, not technology)
- Customer messaging between dispatcher and recipient (needs notification
  channels and abuse controls)

## Discipline

Each slice: plan -> tests -> build -> production verify -> separate commit.
Existing suites must stay green; no cross-module destabilisation.
