# Stage 4 - Fleet Intelligence Release Notes

Release SHAs: `23924ce` (delivery performance), `081ec5f` (trips/stops),
`71b1e4d` (geofencing), `4a8568f` (public tracking), plus the release-closure
commit (security, bounds, E2E).

## Feature summary

- `GET /v1/reports/delivery-performance` (+ CSV, jobId/date filters) - planned
  vs recorded arrival, on-time classification, explicit Unavailable states.
- `GET /v1/reports/trips` / `GET /v1/reports/stops` - query-time segmentation
  over `location_points` with threshold and gap rules.
- PostGIS geofences evaluated during accepted telemetry ingestion, writing
  idempotent enter/exit outbox events and dispatcher alerts.
- Job-scoped public tracking: hashed high-entropy tokens, expiry/revocation,
  rate limiting, polled `/track/:token` page with a live vehicle position.

## Documented limitations (do not oversell)

1. **Sampled GPS boundary detection.** Geofence evaluation runs per accepted
   telemetry sample. A vehicle that crosses a small geofence between two
   samples can complete the crossing without an enter/exit pair. This is
   inherent to sampled GPS and is not claimed otherwise.
2. **Exact-boundary semantics.** PostGIS `ST_Contains` returns false for a
   point lying exactly on the polygon ring; a boundary point counts as
   outside. A transition is recorded on the first sample strictly inside (or
   strictly outside) after the previous state.
3. **Delivery windows.** `job_stops.window_start`/`window_end` are NOT NULL in
   the database, so a genuinely missing window cannot occur through real data.
   The report's Unavailable branch is defensive; the tested unavailable cases
   are missing `arrived_at` and missing `planned_arrival_at`.
4. **Token hygiene.** Public tracking tokens are bearer credentials embedded
   in URLs. Mitigations: SHA-256 at rest, `Cache-Control: no-store` on the
   public endpoint, `Referrer-Policy: no-referrer` on API and web shell, and
   log redaction of `/track/<token>` paths. Revocation takes effect on the
   next request.
5. **Rate limiting.** Public tracking and telemetry limiters are in-memory and
   single-instance, consistent with the existing pilot deployment; multi
   instance deployments need a shared limiter (already on the roadmap).
6. **Report bounds.** All report endpoints enforce a 31-day maximum range and
   resolve explicit from/to, so query-time segmentation can never scan all
   history. `MAX_POINTS` (60,000) bounds a single segmentation pass.

## Verification

- API unit/integration: 75 passing (Stage 4 suites + range/security checks).
- Web tests: 21 passing.
- Browser E2E (`playwright.stage4.config.ts`): geofence creation + telemetry
  ingest, public tracking page + revocation, delivery performance UI + CSV
  download - 3/3 passing against real postgres API and web servers.
- typecheck / lint / build green across the monorepo.

## Deployment checklist

1. Apply migrations `0008` (geofences) and `0009` (tracking_tokens) and the
   post-migration SQL (geometry column, indexes, RLS, definer lookup).
2. Rebuild and restart the API, then rebuild/serve the web dispatcher.
3. Smoke: `GET /healthz`, staff delivery-performance (422 for >31 days),
   create a tracking link and open `/track/<token>`.
