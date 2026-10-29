# CSV bulk ingestion

## Format

One row per stop. Rows sharing `job_ref` are grouped into one job, in file
order. Required columns:

```text
job_ref,address,latitude,longitude
```

Optional columns:

```text
service_type,priority,stop_type,window_start,window_end
```

Defaults: `service_type=Delivery`, `priority=standard`, `stop_type=dropoff`,
window from now to +2 hours. `stop_type` is `pickup`, `dropoff` or `waypoint`.
Maximum 2 MiB / 5,000 rows / 20 stops per job.

## API

### Preview

`POST /v1/jobs/import`

JSON envelope (`{ "csv": "..." }`) or `content-type: text/csv`. The endpoint
validates structure and coordinates, checks duplicate `reference` values in
PostgreSQL, and checks each stop against the configured PostGIS service area.
It returns:

```json
{
  "valid": 3,
  "invalid": 1,
  "duplicates": 0,
  "canCommit": false,
  "preview": [
    {
      "row": 2,
      "jobRef": "IMP-1001",
      "stopCount": 1,
      "address": "10 Downing Street, London",
      "status": "valid",
      "errors": []
    }
  ],
  "jobs": []
}
```

Counts are jobs, not raw CSV rows. The `jobs` array contains only valid,
non-duplicate jobs and is the payload the UI submits.

### Commit

`POST /v1/jobs/import/commit`

```json
{ "jobs": [ ...the preview.jobs array... ] }
```

`idempotency-key` is supported. The server revalidates the payload, rejects
duplicates with `409 IMPORT_DUPLICATES`, and inserts all jobs/stops plus
`job.imported` events and outbox rows in one transaction. Any failure rolls the
whole batch back.

### Errors

- `400 IMPORT_INVALID` — malformed CSV/columns.
- `413 IMPORT_TOO_LARGE` — size/row cap.
- `409 IMPORT_DUPLICATES` — existing job references.
- `422 IMPORT_VALIDATION_FAILED` — bad coordinates/area on commit.

## Dispatcher UI

Jobs & Work Orders has a **Bulk Import** action. It accepts drag-and-drop or a
file picker, shows valid/invalid/duplicate counts and a row table, and disables
commit until all rows are valid and unique. The successful state reports the
imported count and references.

## Validation limitation

This slice has no text geocoder. "Address validation" means non-empty address
text plus a PostGIS `ST_DWithin` check against the configured service area
(default central London, 80 km). The area can be changed with:

```text
IMPORT_SERVICE_CENTER_LAT
IMPORT_SERVICE_CENTER_LNG
IMPORT_SERVICE_RADIUS_METERS
```

Do not describe this as rooftop geocoding.
