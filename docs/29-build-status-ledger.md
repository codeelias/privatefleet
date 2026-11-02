# 29 - Build status ledger

Date: 2026-11-01  
Baseline: `af5549e` (dispatcher map HUD, dock and pager)  
Live environment: LAN pilot, synthetic data only.

This replaces contradictory status statements in earlier documents. Every item
is in exactly one state:

| State | Meaning |
|---|---|
| **Completed** | Implemented, deployed and evidenced against the agreed acceptance behaviour |
| **Started, unfinished** | Working implementation exists, but a named acceptance criterion is still missing or unverified |
| **Uncompleted / superseded** | Previously agreed, but deliberately stopped, replaced or not deliverable as originally scoped - needs an explicit decision, not another sprint |
| **Not yet started** | Agreed scope with no working implementation |
| **Next** | The ordered work that converts the pilot into a sellable product |

---

## 1. Completed

### Platform and tenancy

| Deliverable | Evidence |
|---|---|
| Monorepo, shared contracts, Fastify API | API and web build from one workspace |
| PostgreSQL/PostGIS schema and migrations | through `0012`; policy and work-request tables |
| JWT access/refresh auth | driver and dispatcher login, refresh rotation |
| Row-level security and tenant scoping | RLS enabled, including policy/work-request tables |
| Server-authoritative job lifecycle | arrive, complete, skip, evidence, route completion |
| Command idempotency | idempotency keys; duplicate evidence treated as success |
| Transactional outbox | job/route/request events |
| Orphan-assignment invariant | assigned jobs must be on a published route |
| Manual route close | unfinished work returned to unassigned; driver released |
| Demo/load tenant retirement | `load-8d0a3a98` removed after 773 MB backup; Northstar untouched |
| Native release signing | RSA 4096 keystore, version 1.0.1, signed APK verified |

### Dispatch and optimisation

| Deliverable | Evidence |
|---|---|
| OSRM matrix/geometry + VROOM 1.15 | digest-pinned deployment |
| Visit-order preservation | regression `db50c4c` / `a75ebc7` |
| Proposal, approval and route versioning | stored runs, published routes |
| Dispatch policy presets and revisions | Local / Balanced / Extended; revision 42 live |
| Per-vehicle overrides | API and dispatcher editor |
| Stale-policy approval rejection | `409 STALE_DISPATCH_POLICY` |
| Baseline gate | distance/coverage/working-time comparison |
| New-scope gate correction | only identical job sets are regression-compared |
| Hard per-vehicle limits | VROOM enforces distance/travel/visits |
| Cost-aware recommendations | fuel, vehicle, wage, detour; advisory only |
| 30-job regression | Mo 134.0 km / Sarah 77.4 km / total 211.4 km |

### Driver - native Android

| Deliverable | Evidence |
|---|---|
| Native client, no Expo/JS runtime | `apps/driver-native` |
| PIN login, encrypted session, refresh | Android Keystore AES/GCM |
| Shift start and status | live API |
| Queue, nearest-stop ordering, paging | arrived pinned; pending sorted by GPS distance |
| Arrive / complete / skip | real API lifecycle |
| Signature and camera evidence | `stop_evidence` rows |
| Offline command queue | arrived command survived network loss and synced |
| Offline evidence queue | signature captured offline; evidence count 30 -> 31 |
| Background GPS, screen off | 17 -> 25 telemetry rows with screen off |
| FLAG_SECURE | screenshots/task switcher blocked |
| Request more jobs | durable request + dispatcher decision |

### Dispatcher UI

| Deliverable | Evidence |
|---|---|
| Live Operations map | real routes, vehicles, stops |
| Inset vehicle HUD | 20 px inside map frame; bounded to 52 vh |
| Centered taskbar dock | 46 x 46 px minimized; 440 px bounded popover |
| Explicit 3-up job pager | `1-3 of 15`, Previous/Next, fixed pager footer |
| Assignment sheet | 512 px max, viewport-bounded, body scroll, fixed footer |
| Keyboard/Escape/focus | Escape closes, focus enters dialog |
| Light and dark map themes | verified at 1893, 1366, 1024 and 390 widths |

### Operations

| Deliverable | Evidence |
|---|---|
| LAN DNS | dnsmasq for `.privatefleet.home.arpa` |
| External access | Tailscale Serve, tailnet only; no Funnel |
| TLS | Caddy internal CA; native app trusts it |
| Backups | scheduled `.dump.age` to Google Drive |
| Runbooks | status, restore, VROOM, LAN deployment, native client |
| Current-build E2E | 16 passed / 16 skipped / exit 0, 2.6 min |
| Restore drill | 243.5 s, exit 0, 1,109 geometry stops, 24 RLS tables |
| Health watchdog | every 5 min; Caddy auto-restart tested `000 -> recovered -> 200` |
| Native update channel | API-served manifest/APK; in-app 1.0.4 prompt tested |
| Alert webhook delivery | local sink received structured alert; production URL pending |
| 250-vehicle marker latency | Standard p95 171.6 ms; 2× DPR p95 184.1 ms (1× backing store above 150 vehicles) |

---

## 2. Started, unfinished

| Item | What exists | Missing acceptance |
|---|---|---|
| Phase 1 demo gate | Real API, screens, scenarios, seeded data | E2E not rerun on current build; 120-second rehearsal not evidenced |
| Phase 3 driver gate | Native client completes real work | Dispatcher live update without refresh not re-verified; no push notification for new work |
| Phase 4 tracking gate | GPS, background service, staleness labels | Socket.IO snapshot/reconnect and off-route edge cases not rerun after latest changes |
| Phase 6 hardening | DNS, Tailscale, TLS, backups | Restore drill on current schema, soak/load rerun, monitoring/alerting, release signing |
| Driver request loop | Request and dispatcher decision | Approval does not assign work or re-optimise the route |
| Customer tracking | Portal/tracking components and ETA display | Real customer link, branding, proactive delay notification, dispute-ready proof export not proven |
| Native release | Signed 1.0.4 installed on R5CWB0BR3BP; Mo logged in; session/relaunch and update prompt verified | 8-hour battery soak running |
| High-DPI map performance | Marker latency passes at 184 ms p95 | Frame rate and retina sharpness trade-off recorded |
| Accessibility | Keyboard, focus, labels, Escape | Screen-reader pass and 200% zoom not done |
| Map mobile experience | Responsive dock, assignment sheet | Vehicle HUD intentionally hidden below `md`; no mobile detail sheet |

---

## 3. Uncompleted / superseded

These are not "next". They need a decision or are already decided.

| Item | Status | Decision needed |
|---|---|---|
| Expo-first driver strategy (A6) | Superseded by native Android | Retire Expo from the pilot path and document the architecture change |
| Phase 0 as the first gate | Parked by owner directive; external validation never closed | Name a design partner and agree baseline metrics |
| "Native Kotlin background service" implementation detail | Outcome delivered by native Java foreground service | Accept the implementation change; no work required |
| Original in-memory demo-first architecture | Evolved into real PostgreSQL/PostGIS stack | Accept the stronger architecture; keep demo reset support |

The Expo app still exists as a legacy fallback. Keeping two driver clients is a
maintenance cost and must not become a permanent product decision.

---

## 4. Not yet started

> Completed in Stage A so far: load-tenant retirement (backup retained), signed native release 1.0.1. Remaining Stage A work is verification, alerting, physical install and the commercial baseline/rehearsal.

### Commercial

- Named design partner and real dispatcher workflow sign-off.
- Baseline metrics: stops/day, on-time %, exceptions/day, planning minutes,
  fuel/km.
- Signed pilot scope, support window and success criteria.
- 120-second demo rehearsal and leave-behind ROI sheet.
- DPIA, retention, drivers' hours review, 30-day reliability evidence/SLA.

### Dispatch control loop

- One-click assign + re-optimise with fuel/time/wage impact preview.
- Dispatch-origin resolver: depot/shift start, fresh GPS, dispatcher override,
  LIVE/STALE/DEPOT states.
- Driver request -> candidate job -> assignment.
- Plain-language unassigned and time-window explanations.
- Native push notification for new assignment.

### Customer value

- Branded customer tracking link proven end-to-end.
- Proactive delay/exception notification with revised ETA.
- Proof-of-delivery PDF/link and audit export.
- Weekly operator scorecard.
- Cost-to-serve per job/customer.

### Assurance and scale

- Current-build E2E, load/soak and restore drill.
- Release signing and update channel.
- Monitoring/alert channel and support runbook automation.
- 8-hour battery soak and offline/conflict matrix.
- Certificate-pinning decision, root/tamper detection.
- Tailscale ACL/MFA review and browser CA install.
- Multi-instance rate limiting, dependency upgrades.
- Demo/load tenant cleanup and historical route closure.

---

## 5. Next

### Stage A - Prove and package (2-3 weeks)

1. ~~Audit/clean demo and load tenants~~; close remaining historical Northstar routes.
2. Rerun E2E, load/soak and restore drill on the current schema.
3. ~~Release-sign the native app~~; define the internal update path and install on the phone.
4. Add alerting and a one-page support escalation runbook.
5. Prepare the operator baseline sheet and rehearse the 120-second demo.

**Gate:** a named operator has watched the demo, agreed metrics and signed a
scoped pilot; current-build evidence is green.

### Stage B - Close the dispatch loop (3-4 weeks)

1. Dispatch-origin resolver.
2. One-click assign + re-optimise, preserving arrived/completed stops and
   rejecting stale policy.
3. Driver request -> candidate -> assignment.
4. Plain-language reasons and time-window explanations.
5. Native push for new work.

**Gate:** new job to published compliant route in one reviewed action, with no
orphan assignments.

### Stage C - Customer value (3-4 weeks)

1. Branded tracking + reliable ETA.
2. Proactive delay/exception notification.
3. Proof/audit export.
4. Operator scorecard and cost-to-serve.

**Gate:** a real customer uses the link and the operator can show improvement
against the Stage A baseline.

### Stage D - Assure and scale

SLO/30-day evidence, DPIA/retention, accessibility, security review, dependency
and rate-limit hardening.

---

## 6. Metrics that decide progress

```text
stops/day
on-time % (promised window vs actual)
planning minutes per day
km and fuel cost per stop
jobs per driver per shift
exceptions caught before the customer calls
evidence success rate, including offline
tracking uptime and stale-pin rate
dispatcher interventions per 100 stops
driver crash-free sessions and battery drain per shift
support tickets per 100 stops
```

No feature is "completed" for commercial purposes until it moves one of these
or is required by a signed pilot gate.
