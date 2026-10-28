# 16b - Production deployment runbook (post-signature)

**Status:** prepared 2026-10-28, not executed against a customer. Engineering is
frozen at the Phase 1 demo; execute this runbook only after a signed pilot
contract and a scheduled deployment window.

**Numbering note:** `16-routing-engine-architecture.md` remains the routing
design document. This file is the operational runbook requested for the
freeze; both share the 16 prefix.

## 1. What is frozen and what this runbook activates

Frozen today (Phase 1 demo, default):

- `pnpm dev` boots the DEMO_MODE API, dispatcher web app and driver web app
  with in-memory repositories, seeded fixtures and no Docker dependency.
- Routing geometry is the committed OSRM-derived fixture set; the optimization
  screen shows the labelled simulated proposal.

Activated by this runbook (post-signature):

- Real Postgres + PostGIS, real driver-device telemetry and authenticated
  sockets (implemented and tested, migrations 0003/0004).
- Real OSRM + VROOM containers for live proposals and route publication
  (implemented and tested against protocol fakes and a live public OSRM;
  the container-backed gate has not been executed yet - section 9).

## 2. Host prerequisites

- Docker Desktop with Linux containers. Verified host: Docker Desktop 4.95.0,
  engine 29.8.2 at `192.168.1.128` (Windows 11), accessed over SSH.
- Postgres 16 with PostGIS 3.4. Local dev uses WSL Ubuntu; production uses a
  managed instance or VM with backups.
- Node 22 + pnpm 12 on the API/web host.
- CPU/RAM for OSRM extract/partition; the Greater London extract used here is
  130 MB and prepares in minutes on a laptop-class CPU.

## 3. Pinned routing services

| Component | Pinned version | Notes |
|---|---|---|
| OSRM backend | `osrm/osrm-backend:v5.25.0` | Last official Docker Hub tag (Docker Hub verified 2026-10-28; `v5.27.1` does not exist on Hub) |
| VROOM | `vroomvrp/vroom-docker:v1.13.0` | Latest stable Hub tag; only `v1.14.0-rc.*` exists above it |
| OSM data | Geofabrik `greater-london-latest.osm.pbf` | 129,863,196 bytes, sha256 `CFD508553AF738965A75F9D90D7390F4C552EF981813526E7C52A2F8F88BBD0D`, downloaded 2026-10-28; ODbL attribution required |
| Profile | OSRM `car.lua` (image default) | Document any change; profiles change ETAs |

Record the exact digest actually deployed (`docker image inspect --format`)
in the customer deployment log; tags are mutable.

## 4. Prepare the OSRM dataset

On the Docker host (Linux containers):

```sh
docker volume create privatefleet-osrm
# copy the pinned extract onto the host, e.g. to /srv/privatefleet/greater-london.osm.pbf
docker run --rm -v privatefleet-osrm:/data -v /srv/privatefleet:/host \
  osrm/osrm-backend:v5.25.0 cp /host/greater-london.osm.pbf /data/
docker run --rm -v privatefleet-osrm:/data osrm/osrm-backend:v5.25.0 \
  osrm-extract -p /opt/car.lua /data/greater-london.osm.pbf
docker run --rm -v privatefleet-osrm:/data osrm/osrm-backend:v5.25.0 \
  osrm-partition /data/greater-london.osrm
docker run --rm -v privatefleet-osrm:/data osrm/osrm-backend:v5.25.0 \
  osrm-customize /data/greater-london.osrm
```

Windows Docker Desktop equivalent: replace host paths with Windows paths
(`-v C:\srv\privatefleet:/host`). Do not use the public OSRM demo server as a
customer dependency; its usage policy is best-effort and may be withdrawn.

## 5. Run OSRM and VROOM

```sh
docker run -d --name privatefleet-osrm -p 5000:5000 \
  -v privatefleet-osrm:/data \
  osrm/osrm-backend:v5.25.0 \
  osrm-routed --algorithm mld /data/greater-london.osrm

docker run -d --name privatefleet-vroom -p 3000:3000 \
  -e OSRM_URL=http://host.docker.internal:5000 \
  vroomvrp/vroom-docker:v1.13.0
```

Health checks:

```sh
# OSRM: expect {"code":"Ok",...}
curl "http://<host>:5000/route/v1/driving/-0.1278,51.5074;-0.078,51.5265?overview=false"

# VROOM: matrix-mode smoke (no external OSRM needed when matrices are supplied)
curl -s -X POST "http://<host>:3000/" -H "content-type: application/json" -d '{
  "vehicles":[{"id":0,"start_index":0,"end_index":0}],
  "shipments":[{"pickup":{"id":"s1::pickup","location_index":1},"delivery":{"id":"s1::delivery","location_index":2},"amount":[1]}],
  "matrices":{"car":{"durations":[[0,60,120],[60,0,60],[120,60,0]],"distances":[[0,600,1200],[600,0,600],[1200,600,0]]}}
}'
# expect {"code":0,...}; if the container logs show a router error, set OSRM_URL correctly.
```

Publish only to the API host or VPN. Do not expose 5000/3000 publicly.

## 6. Provision Postgres and start the API

1. Create roles: `privatefleet` (owner, migrations) and `privatefleet_app`
   (runtime, RLS enforced). See `scripts/db-setup.sql`.
2. Run migrations as the owner:
   `MIGRATION_DATABASE_URL=postgres://privatefleet:... pnpm --filter @privatefleet/api db:migrate`
   This applies drizzle migrations plus `post-migration.sql` (PostGIS columns,
   RLS policies, auth functions). Verify `location_points`, `routes`,
   `route_stops`, `optimization_runs` exist and have RLS enabled.
3. Provision the first tenant with the scripted seed/provisioning path; do not
   reuse demo fixtures in production.
4. API environment:

```sh
REPOSITORY_MODE=postgres
DATABASE_URL=postgres://privatefleet_app:.../privatefleet
MIGRATION_DATABASE_URL=postgres://privatefleet:.../privatefleet
AUTH_JWT_SECRET=<32+ byte secret>
CORS_ORIGINS=https://dispatch.<customer-domain>
OSRM_BASE_URL=http://<osrm-host>:5000
VROOM_BASE_URL=http://<vroom-host>:3000
```

`OSRM_BASE_URL` and `VROOM_BASE_URL` must be set together; the API refuses a
half-configured pair. Without them the live optimization endpoint returns a
typed 503 and manual dispatch continues to work.

5. Start the API (`pnpm --filter @privatefleet/api start` or the built image).

## 7. Acceptance gate against the real services

With the pinned containers reachable:

1. Sign in as a dispatcher on the production/rehearsal tenant.
2. Assign at least one pickup/dropoff pair to a driver with a vehicle position.
3. `POST /v1/optimization/run` with that driver id: expect `engine:
   "osrm+vroom"`, ordered stops, a road geometry of >= 2 finite points and
   matrix size > shipments.
4. Approve with the current `routeVersion`: expect a new version (initial 1 ->
   2) and a `route.published` outbox event.
5. `GET /v1/fleet/state`: expect the route with the new version, and the same
   version in `routeVersion`.
6. Approve with the previous version again: expect `409 ROUTE_VERSION_STALE`.
7. Stop VROOM: propose again -> typed 503; the last published route must remain
   intact and manual dispatch must still work.

The same flow is automated in `apps/e2e/tests-auth/optimization-live.spec.ts`
against fake services; point that spec's `OSRM_BASE_URL`/`VROOM_BASE_URL` at the
real containers for the container-backed version of this gate.

## 8. Web and TLS

1. `pnpm build` and serve `apps/web/dist` (or the built image) behind Caddy
   with TLS for the branded domain.
2. Proxy `/v1/*` and `/socket.io/*` (WebSocket upgrade) to the API; set
   `CORS_ORIGINS` to the branded origin.
3. Driver device app: the RN-web build is verified; the Expo native build is
   produced via EAS when a device build is needed. Foreground location sharing
   is implemented; native background location is deliberately deferred.

## 9. What is NOT proven at freeze (known limitations)

- **Container-backed routing gate not yet executed.** Docker Desktop was
  reachable over SSH (`192.168.1.128`), but image pulls from that SSH session
  were blocked by Docker Desktop's credential helper ("logon session does not
  exist"); pulling via the registry API was prepared but not completed before
  the freeze directive. The adapters are proven against a live public OSRM and
  protocol-faithful fake VROOM only.
- Multi-vehicle optimisation is not implemented (one driver per proposal).
- Native background GPS/geofencing is not implemented; staleness is surfaced
  honestly.
- Rate limiting is process-local; horizontal API scaling needs shared state.
- Socket rooms assume a single API instance (no Redis adapter).
- Map basemap tiles are fetched from public providers; with no internet the
  app still boots and routes/pins render, but the basemap background is blank.
  For a venue with no connectivity, use a local tile cache before the pitch.

## 10. Rollback and outage behaviour

- Route publication is transactional: a failed approval leaves the previous
  published route authoritative.
- OSRM/VROOM outage affects optimisation only; telemetry, job actions, map and
  manual dispatch remain available (typed 503).
- Database restore: restore the last verified dump, re-run migrations, restart
  the API; clients recover via the authenticated snapshot.
- Keep the previous container image digests and the previous `greater-london`
  extract until the new deployment passes the section 7 gate.
