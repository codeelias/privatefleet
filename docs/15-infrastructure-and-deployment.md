# 15 - Infrastructure & Deployment

**Status:** Draft v1 - for approval.
**Related:** [02.4](02-architecture-overview.md) (environments), [ADR-0010](adr/0010-map-tiles.md) (tiles).

## 15.1 Environments

| Env | Purpose | Data | Stack |
|-----|---------|------|-------|
| `dev` | Local development | In-memory (DEMO_MODE) or Compose Postgres | Node processes + Compose subset |
| `demo` | Honey Pot for prospects | Seeded scenarios; reset per session + nightly | VPS: Caddy (static web + driver export) + API with `DEMO_MODE=true` |
| `staging` | Release validation, restore drills | Synthetic, mirrors prod schema | Compose stack + migrations from CI |
| `prod` | Pilot tenant(s) | Real data | Managed VM or hosted Postgres; Caddy; encrypted backups |

## 15.2 Docker Compose services (dev & staging)

| Service | Image | Notes |
|---------|-------|-------|
| `postgis` | `postgis/postgis:16-3.4` | Init script creates roles (`app_runtime`, `app_migrator`) + extensions |
| `minio` | `minio/minio` | S3-compatible object storage for POD media in dev/staging |
| `osrm` | `osrm/osrm-backend` | Prepared extract (GB default); matrix + route services |
| `vroom` | `vroomvrp/vroom-docker` | Solver; stateless HTTP |
| `caddy` | `caddy` | Reverse proxy + TLS; static files for demo web/driver exports |

Phase 1 needs **none** of this to run the demo (in-memory mode) - Compose becomes required from Phase 2 for Postgres.

## 15.3 Demo deployment

- **Orchestration host (owner decision, 2026-10-27):** all containers and demo deployments run on the Windows 11 host `Alemnesh` (<lan-host>, SSH alias `privatefleet`, user `deploy`) via Docker Desktop (verified: Docker Desktop 4.95.0, engine 29.8.2, WSL2 backend). The Linux VPS option from earlier drafts is superseded. SSH uses `~/.ssh/deploy_auto_ed25519` (see CHANGELOG v1.7).
- `DEMO_MODE=true`, scenario seeds, nightly reset via a scheduled API call; health checks on `/healthz` + `/readyz`; uptime alerting (simple, external).
- **Prospect sandboxes:** per-prospect branded demo tenants (their uploaded logo, 48-72 h expiry) provisioned by the demo module on the same stack - the leave-behind from [14.2c](14-roadmap-and-gates.md); reset nightly with the other demo data.
- The demo deployment is rebuilt from CI artifacts - the deployed demo is exactly the tested demo.

## 15.4 Production deployment (pilot)

- API + web behind Caddy; managed or self-managed Postgres with the RLS roles provisioned by the init/migration scripts.
- One API instance initially (single-region, modest fleet). Multi-instance Socket.IO (Redis adapter) and a standalone outbox worker are documented follow-ups when metrics justify them - the outbox table makes that extraction schema-safe ([09.3](09-realtime-tracking.md)).
- Custom domains: only after the verified-hostname flow ([11.5](11-security-and-compliance.md)).

## 15.5 Backups & recovery

- Daily encrypted `pg_dump` to off-site object storage (versioned); WAL/PITR added before multi-tenant scale.
- Monthly **restore drill into staging** - a Phase 6 gate and a standing operational task.
- POD media protected by bucket versioning + lifecycle rules ([07.8](07-database-design.md)).

## 15.6 Maps & cost posture

- Tiles: OpenFreeMap (free, no key) for demo/dev; provider decision reviewed before heavy production traffic ([ADR-0010](adr/0010-map-tiles.md)). No Google Maps dependency - that's part of the commercial story, not just a technical choice.
- Hosting budget is tracked per environment; tile/bandwidth costs are a line item in the pilot's running-costs summary for the customer (licence vs. infrastructure split is contractual, [01.3](01-vision-and-principles.md)).

## 15.7 Logs & monitoring

- pino JSON -> stdout; demo/staging use a lightweight log shipper or plain rotation; prod adds alerting on error rate, outbox lag, and health.
- No PII in logs (central redaction, [11.9](11-security-and-compliance.md)).



