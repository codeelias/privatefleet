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

**Pilot baseline and 120-second rehearsal kit:**
[`docs/32-pilot-baseline-and-rehearsal-kit.md`](docs/32-pilot-baseline-and-rehearsal-kit.md)

**Dispatch Board redesign:**
[`docs/33-dispatch-board-redesign.md`](docs/33-dispatch-board-redesign.md)

**Jobs & Work Orders redesign:**
[`docs/34-jobs-work-orders-redesign.md`](docs/34-jobs-work-orders-redesign.md)

**PF-TIDE positioning programme:**
[`docs/45-pf-tide-programme.md`](docs/45-pf-tide-programme.md)

**Stationary-aware location engine:**
[`docs/44-stationary-aware-location.md`](docs/44-stationary-aware-location.md)

**RTK solver integration (RTKLIB/JNI):**
[`docs/43-rtk-solver-integration.md`](docs/43-rtk-solver-integration.md)

**RTK correction transport:**
[`docs/42-rtk-correction-transport.md`](docs/42-rtk-correction-transport.md)

**Fused positioning (GNSS + IMU EKF):**
[`docs/41-fused-positioning-ekf.md`](docs/41-fused-positioning-ekf.md)

**Visual geofence editor:**
[`docs/40-visual-geofence-editor.md`](docs/40-visual-geofence-editor.md)

**Customer Edge batch:**
[`docs/39-customer-edge-navigation-follow-tracking-geofencing.md`](docs/39-customer-edge-navigation-follow-tracking-geofencing.md)

**Heads-Up predictive operations:**
[`docs/37-heads-up-predictive-operations.md`](docs/37-heads-up-predictive-operations.md)

**Map positioning, camera and navigation:**
[`docs/36-map-positioning-camera-navigation.md`](docs/36-map-positioning-camera-navigation.md)

**Route Optimisation workbench:**
[`docs/35-route-optimisation-workbench.md`](docs/35-route-optimisation-workbench.md)

These documents list exactly what is deployed, what is still pending, known
data issues, operations commands and the relevant commits. Read them before
changing dispatch behaviour or demonstrating the system.

## Topology

```text
Driver Android app --HTTPS--> Caddy --> API :4000 --> PostgreSQL :5432
                                      |
                                      +--> OSRM :5000 / VROOM :3000 (LAN only)
Dispatcher web --> https://app.privatefleet.home.arpa (Caddy)
External access --> Tailscale Serve (tailnet only)
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

The live pilot runs on a dedicated LAN host (address kept out of this public
README). Restart and rollback procedures live in the internal runbook, which
is not published here.








