# POD and failed-delivery vertical slice

## Scope

This increment adds a single tenant-safe evidence workflow for the Expo driver
pilot and the dispatcher web app:

- recipient name + notes, signature, and photo capture;
- server-enforced proof policy;
- structured failed-delivery reasons;
- a real PostgreSQL-backed exception alert;
- private filesystem evidence storage;
- durable Expo offline evidence queue;
- authenticated dispatcher retrieval;
- evidence media in the encrypted backup.

It deliberately does not add background GPS, geofencing, CSV import, SMS/email,
reporting, or a second native workflow.

## Evidence policy

`proof_policies` is keyed by `(tenant_id, service_type)`. `service_type = '*'`
is the tenant default; a matching exact service type overrides it.

The seeded/documented default is:

| Requirement | Default |
|---|---|
| recipient name | required |
| signature | optional |
| delivery photo | optional |
| failure photo | optional |

`GET /v1/proof-policy` returns the resolved policy. An owner/admin can set a
policy with `PUT /v1/proof-policy`:

```json
{
  "serviceType": "*",
  "requireRecipient": true,
  "requireSignature": true,
  "requirePhoto": true,
  "requireFailurePhoto": true
}
```

Completion checks the policy before any state transition. Missing proof returns
`422 EVIDENCE_REQUIRED` and leaves the stop untouched. Evidence is checked by
tenant-scoped `stop_evidence` rows, not by trusting a client-supplied list.

## API contracts

### Evidence

`POST /v1/jobs/:jobId/stops/:stopId/evidence` (driver token, assigned stop)

```json
{ "kind": "signature", "pathData": "M10 10 L20 20", "capturedAt": "..." }
```

or `kind: "photo" | "failure_photo"` with `dataBase64`.

Response:

```json
{
  "id": "uuid",
  "kind": "signature",
  "mimeType": "image/svg+xml",
  "byteSize": 266,
  "contentHash": "sha256...",
  "capturedAt": "...",
  "uploadedBy": "driver uuid"
}
```

`GET /v1/jobs/:jobId/stops/:stopId/evidence` returns the metadata plus
`dataBase64` for authorised dispatcher/driver display. There is no public media
URL.

### Completion / failure

- `POST .../complete`: existing body (`driverId`, `recipientName`, `notes`)
  plus policy enforcement. Idempotency key replay returns the original result.
- `POST .../skip`: `reasonCode` from `RECIPIENT_UNAVAILABLE`,
  `DELIVERY_REFUSED`, `ADDRESS_ACCESS_PROBLEM`, `ITEM_DAMAGED`,
  `VEHICLE_OPERATIONAL_PROBLEM`, `OTHER`, with optional `note`.
  Legacy `reason` is mapped to `OTHER` and retained as the note.

A skip writes the stop failure code/note, an immutable `job.skipped` event,
the outbox event, and an open alert in one transaction. The alert carries
`job_id` and `stop_id`, which the dispatcher uses to load evidence.

## State semantics

Successful completion: `pending|arrived -> completed`, then the existing job
rollup runs. A single stop does not force a multi-stop job terminal while other
stops remain pending.

Failure: `pending|arrived -> skipped`; the job rollup is unchanged from the
existing domain semantics. If another stop is pending the job remains
`in_progress`; if all stops are skipped it is `skipped`; if at least one stop
completed it is `completed`. The failure remains visible as an open alert and
as `failureCode`/`failureNote` on the stop.

## Media storage

- Root: `EVIDENCE_DIR` (deployed: `C:\PrivateFleet\evidence`), outside the web
  root.
- Server-generated key: `<tenant>/<stop>/<uuid>.<png|jpg|webp|svg>`.
- PostgreSQL stores metadata, storage key, SHA-256, MIME, size, capture time and
  uploader; bytes never go into `job_events`.
- Media magic bytes are validated; client MIME is not trusted.
- Limits: signature 512 KiB, photo 8 MiB.
- Signature paths are restricted to the SVG `M`/`L` numeric grammar and wrapped
  in a server-generated SVG; arbitrary markup is rejected.
- If the DB insert fails after a file write, the file is removed.
- Access is tenant-scoped by RLS and stop ownership; media has no unauthenticated
  URL.

## Expo offline queue

`apps/driver-expo/src/queue.ts` persists commands in AsyncStorage. Small
signature path text is stored in the command; photographs remain in
app-private file storage (`expo-file-system`) and only the URI is queued.
Binary photos are never base64 in AsyncStorage. The Expo web export does not offer durable photo storage; it shows a clear error and the native pilot build is the supported camera path.

Ordering on sync:

1. upload required evidence (server duplicate detection uses SHA-256);
2. submit the idempotent completion/skip;
3. mark accepted and persist the queue;
4. only then delete local media.

Network/transient failures remain `pending`; 4xx responses become `conflict`
with the server message and preserve the media. The queue survives process
restart. A crash after server acceptance cannot leave a pending command whose
evidence was deleted because acceptance is persisted first.

## Backup and recovery

`backup.ps1` now produces, for the same timestamp:

- `privatefleet-<stamp>.dump.age` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â PostgreSQL custom dump;
- `privatefleet-<stamp>.evidence.tar.age` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â entire private evidence directory.

Both are SHA-256 checksummed and copied to `D:\PrivateFleet_Backups`. The age
private key is not in either archive or the evidence directory.

Recovery drill result using `pg_restore --jobs=4` in an isolated database,
including route/location geometry and the evidence files:

```text
PG_RESTORE_JOBS=4
PG_RESTORE_EXIT=0
RESTORE_SECONDS=242.8
TOTAL_RTO_SECONDS=474.9
EVIDENCE_HASH_MATCHED=2 HASH_FAILED=0
RUNTIME_OWN_EVIDENCE=2 RUNTIME_FOREIGN_EVIDENCE=0
RESTORE_DB_DROPPED=yes
jobs=878
routes=21462
route_stops=228720
location_points=30539
job_stops_geom=987
evidence=2
RESTORE_ERROR_LINES=0
```

The production archive itself is encrypted with the offline age key. The
operator must mount that key on a controlled restore workstation to decrypt
the archive; this end-to-end encrypted-archive decryption is still NOT
VERIFIED until the key is provided. The geometry restore above used a fresh
full dump of the same live database, so it proves the post-decryption restore
procedure and the geometry/RTO path, not possession of the offline key.

## Verification status

- API tests: 67 passed, including CSV preview/atomic commit/duplicates plus policy rejection without state change,
  evidence upload/retrieval, idempotent completion/skip, real alert creation,
  RLS on `proof_policies`/`stop_evidence`.
- Web tests: 21 passed.
- CSV import E2E: 1 passed (3 valid + 1 invalid preview, commit disabled, corrected 4-job commit).
- Expo queue tests: 4 passed, including restored signature/photo evidence after a simulated app restart and evidence upload before completion.
- Workspace typecheck/lint/build: all pass.
- Expo web export and web dispatcher build pass.
- Live API exercise: signature + photo uploaded, completion returned 200,
  dispatcher retrieved both media, failure returned 200 and created one open
  alert with a linked job/stop.
- Physical iOS/Android camera, native signature rendering, process-kill
  recovery on a real device and native upload are **NOT VERIFIED**: no physical
  device is connected and no native build has been run. The Android SDK/JDK are
  present, but Stage A/B remain gated. Expo web and automated queue tests are not
  a substitute for that evidence.




