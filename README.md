# PrivateFleet

LAN-first multi-tenant courier dispatch platform. Synthetic data only.

**Authoritative current status and runbook:**
[`docs/24-system-status-and-runbook.md`](docs/24-system-status-and-runbook.md)

**Consolidated stage review and commercial build order:**
[`docs/27-stage-plan-review-and-build-order.md`](docs/27-stage-plan-review-and-build-order.md)

**Authoritative five-state build ledger:**
[`docs/29-build-status-ledger.md`](docs/29-build-status-ledger.md)

**Data retirement and release signing:**
[`docs/30-data-retirement-and-release-signing.md`](docs/30-data-retirement-and-release-signing.md)

**Current-build verification and recovery:**
[`docs/31-current-build-verification.md`](docs/31-current-build-verification.md)

These documents list exactly what is deployed, what is still pending, known
data issues, operations commands and the relevant commits. Read them before
changing dispatch behaviour or demonstrating the system.

## Topology

```text
Driver Android app Ã¢â€â‚¬Ã¢â€â‚¬ HTTPS Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº Caddy Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº API :4000 Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€“Âº PostgreSQL :5432
                                     Ã¢â€â€Ã¢â€â‚¬Ã¢â€â‚¬ OSRM :5000 / VROOM :3000
Dispatcher web Ã¢â€â‚¬Ã¢â€â‚¬ https://app.privatefleet.home.arpa
External access Ã¢â€â‚¬Ã¢â€â‚¬ Tailscale Serve (tailnet only)
```

## Local development

```powershell
pnpm install
pnpm --filter @privatefleet/api db:migrate
pnpm --filter @privatefleet/api dev
pnpm --filter @privatefleet/web dev
```

## Non-negotiable security rules

- PostgreSQL stays bound to `127.0.0.1:5432`.
- Never use Tailscale Funnel or port forwarding for the database.
- Tailscale Serve is for the API only and stays tailnet-only.
- The driver app is distributed only to pilot devices.

## Deployment

The live pilot runs on the Windows host at `192.168.1.128`. Restart and rollback
procedures are in the status/runbook document.


