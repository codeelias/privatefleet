# PrivateFleet

LAN-first multi-tenant courier dispatch platform. Synthetic data only.

**Authoritative current status and runbook:**
[`docs/24-system-status-and-runbook.md`](docs/24-system-status-and-runbook.md)

That document lists exactly what is deployed, what is still pending, known data
issues, operations commands and the relevant commits. Read it before changing
dispatch behaviour or demonstrating the system.

## Topology

```text
Driver Android app ── HTTPS ──► Caddy ──► API :4000 ──► PostgreSQL :5432
                                     └── OSRM :5000 / VROOM :3000
Dispatcher web ── https://app.privatefleet.home.arpa
External access ── Tailscale Serve (tailnet only)
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
