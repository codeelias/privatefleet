# Figma Design Extract - Fleet Operations UI/UX Master Design

**Source:** `Fleet Operations - UI UX Master Design` (Figma file `fnFeIyZr87XvelShaqyIVz`, version `2415061949869325185`), extracted via the Figma REST API.
**Raw artifacts:** `.figma/file.json` (full API response) and `.figma/text-dump.txt` (generated text extraction) - kept as scratch for re-extraction; this file is the curated, reviewable version.
**Status:** Draft v1.3 - integrated into the documentation package.

The design is the visual contract for [05](../05-web-app-architecture.md) and [06](../06-driver-app-architecture.md). Where the design text states a rule, that rule is normative for implementation and mirrors the engineering rules already documented - the two were written in parallel and agree.

## 1. Structure

| Page | Frames |
|------|--------|
| `00 - Foundations & Components` | Fleet Ops Design System (1600 x 1200) |
| `01 - Dispatcher Console` | Screen / Live Operations  /  Screen / Dispatch Board  /  Screen / Route Optimisation  /  Screen / Exceptions & Alerts  /  Screen / Customer Tracking & Proof (each 1440 x 940) |
| `02 - Driver App & Customer Portal` | Driver / 01 Today & Route Queue  /  Driver / 02 Active Job  /  Driver / 03 Proof of Service & Exceptions (each 390 x 844)  /  Customer Portal / Order tracking (1440 x 940, light) |

Frame dimensions define the canonical layouts: **1440 x 940 dispatcher** (matches the >=1440 px command-center tier in [05.1b](../05-web-app-architecture.md)), **390 x 844 driver** (matches the mobile screen), **1440 x 940 light portal**.

## 2. Design tokens (from "Fleet Ops Design System")

### Color tokens

| Token | Hex | Use | Tailwind mapping |
|-------|-----|-----|------------------|
| Command / Background | `#0F172A` | Dispatcher screen background | `slate-900` |
| Command / Surface | `#1E293B` | Panels, cards | `slate-800` |
| Raised Surface | `#263449` | Elevated elements | custom |
| Primary / Blue | `#4F8CFF` | Primary actions, selection | custom |
| Success | `#10B981` | On time / on track | `emerald-500` |
| Warning | `#F59E0B` | At risk | `amber-500` |
| Danger | `#EF4444` | STAT, late, critical | `red-500` |
| Primary Text | `#F8FAFC` | Headings, key values | `slate-50` |
| Secondary Text | `#94A3B8` | Labels, secondary info | `slate-400` |
| Border | `#334155` | Dividers, outlines | `slate-700` |
| Driver background | `#080D16` | Driver app screens | darker than slate-900 |
| Portal background | `#F4F7FB` | Public tracking page (light) | near-slate-50 |

### Typography (Inter)

| Style | Use |
|-------|-----|
| Inter 32 Bold | Primary page titles and key metrics |
| Inter 22 Semi Bold | Panel titles and high-priority details |
| Inter 15 Regular | Body and table content ("readable body text, short labels, predictable numeric alignment") |

### Spacing & shape

- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 px.
- Radius scale: 8 / 12 / 16 / 24.
- Driver interaction rules (normative): minimum touch target **48 x 48 px**; primary actions **56 px high**; critical actions use slide-to-confirm; offline state is always explicit; no ambiguous icons for critical actions.

### Design principles (from the system frame)

> calm density * visible freshness * explicit state * reversible planning * honest optimisation

These map directly to the documented rules: calm density -> [05.1b](../05-web-app-architecture.md) Calm Command Center; visible freshness -> last-update labels everywhere (e.g., "Last GPS fix  /  12 seconds ago", "LAST UPDATED 8 SEC AGO"); explicit state -> ghost pins and stale labels ([09.7](../09-realtime-tracking.md)); reversible planning -> draft/publish route versions ([08.2](../08-domain-model-and-events.md)); honest optimisation -> simulated-result labelling ([10.4](../10-optimization-integration.md)).

### Reusable components (named in the system frame)

Status chips (`ON TIME`, `AT RISK`, `LATE`, `STALE`), `Assign job`, `Preview customer`, `Report exception`, `Slide to arrive`, KPI counters, job cards, driver cards, exception cards.

## 3. Dispatcher screens - extracted content

### 3.1 Live Operations (1440 x 940, `#0F172A`)

- **Shell:** brand `FLEET OPERATIONS / NORTHSTAR`, live clock ("Tue, 27 Oct 2026", "LIVE"), left nav - Workspace: Live Operations, Dispatch Board, Jobs & Work Orders, Route Optimisation, Exceptions & Alerts, Customer Tracking; Manage: Drivers & Vehicles, Reports, Settings.
- **KPI strip:** 12 active vehicles (3 on route)  /  28 jobs in progress (6 due in 30 min)  /  4 unassigned (1 urgent)  /  3 at-risk stops (2 need action).
- **Map:** "LONDON  /  MAP LAYERS"; ghost-pin rule stated on-canvas: *"Grey ghost pins show last known position - never imply a fresh GPS fix."*
- **Unassigned jobs drawer:** "DRAG TO ASSIGN" - J-208 STAT  /  Farringdon; J-214 Pickup  /  Camden; J-221 Collection  /  London Bridge.
- **Selected vehicle panel:** Alex Brooks  /  VAN-04  /  En route  /  `AT RISK`; current assignment J-198  /  Urgent pickup; next stop St Thomas' Hospital; estimated arrival 14:42 (`+8 MIN`); "Last GPS fix  /  12 seconds ago".
- **Needs-attention feed:** "J-198 likely to arrive 8 minutes late", "Driver stationary at pickup for 6 minutes" - with Review-exception actions.
- **Live connection indicator:** "Fleet stream connected / LIVE CONNECTION".
- **Driver roster initials avatars** (AB, TC, SR, MK, JS) with last-known states.

### 3.2 Dispatch Board (1440 x 940)

- Gantt lanes per driver/vehicle, 06:00 -> 18:00; day header "TUE 27 OCT  /  DAY SHIFT"; filters "All drivers 8 / Unassigned 4"; actions "+ New job", "Publish plan".
- Job blocks carry codes (J-182 ... J-219) with types (Pickup / Drop / Collection / Delivery / Transfer / Clinic / STAT / Urgent); legend: on time / at risk / late / conflict.
- **Drop preview:** "VALID DROP TARGET  /  SARAH REED" with impact copy *"J-208 STAT -> next ETA +6 min  /  inside window"* - the Smart Gap preview from [05.5](../05-web-app-architecture.md), exactly as specced.
- On-canvas demo note: *"Demo interaction state  /  server validates every commit."* - matches the server-authoritative rule ([08.3](../08-domain-model-and-events.md) invariant 7).

### 3.3 Route Optimisation (1440 x 940)

- **Split comparison:** CURRENT PLAN - 08:48 Pickup, 09:35 Drop (+11 min), 10:10 Pickup, 11:05 Delivery (+7 min), 12:20 End; 31.6 mi, 2h 18m, "2 time windows at risk" - versus **OPTIMISATION PROPOSAL (DRAFT V2)** - Sarah Reed  /  6 stops: 08:15 Start Farringdon depot -> 08:36 Camden clinic -> 09:08 Islington centre -> 09:42 St Thomas' Hospital -> 10:22 London Bridge -> 11:40 Return to depot; 23.2 mi, 1h 55m, "Configured windows feasible", "ETA OK".
- **Delta banner:** "23 min estimated time saved"  /  "8.4 mi less travel vs. baseline sequence" - labelled **SIMULATED RESULT**, with the on-canvas honesty note: *"Savings are simulated demo data. Production metrics must come from routing-engine output."* This is the exact rule documented in [10.4](../10-optimization-integration.md) and the presenter's rule in [14.2b](../14-roadmap-and-gates.md).
- **Action:** "Publish approved plan" - matches the proposal -> approval -> publication flow ([10.2](../10-optimization-integration.md)).

### 3.4 Exceptions & Alerts (1440 x 940)

- **Header stats:** 3 OPEN  /  2 ACKNOWLEDGED exceptions.
- **Highest-impact cards:** URGENT - "J-198 may miss the pickup window" (Alex Brooks  /  VAN-04  /  St Thomas' Hospital, ETA drift +8 min); AT RISK - "Sarah has been stationary for 15 minutes" (VAN-02  /  Camden clinic); STALE GPS - "Vehicle CAR-08 has stopped reporting" (J. Singh  /  last known near Farringdon); GEOFENCE - "Tom Cole  /  London Bridge service area - vehicle exited the expected service zone".
- **Recommended action** with estimated impact ("Reassign to Sarah Reed after her current stop. Estimated impact: +3 min to the next job.") and **audit history** ("10:21  /  ETA drift crossed 5-minute threshold", "10:22  /  Alert automatically created") - matches the actionable-exceptions design ([05.3](../05-web-app-architecture.md) Screen 4) and the event audit log ([08.4](../08-domain-model-and-events.md)).
- **Active service zones grid:** St Thomas' Hospital (2 vehicles inside), Camden Clinic (1 inside), London Bridge Dock (unexpected exit), Farringdon Depot (no recent arrivals) - the geofence status board.

### 3.5 Customer Tracking & Proof (1440 x 940)

- **Configuration panel:** Brand identity (Northstar Transport, verified domain `northstar.example/tracking`); Customer notifications ("Send ETA updates automatically - notify on en route, delay and near-arrival transitions", update cadence, "ETA DELTA > 5 MIN", "STATUS CHANGES"); Tracking link access ("Links expire after 72h; revoke anytime. One link = one job."); Proof-of-service requirements (Recipient name required, Photo optional, Signature optional).
- **Live preview  /  customer view:** branded NORTHSTAR page, "Your delivery is on the way", DRIVER EN ROUTE, estimated arrival 14:42, delivery-status timeline (Booking confirmed [x] -> Collected [x] -> On the way * -> Delivered o), "Proof of service - available after completion".
- **Privacy note on-canvas:** *"No fleet-wide data or unnecessary driver details exposed. Single job only."* - the [11.4](../11-security-and-compliance.md) minimal-DTO rule, stated as UI copy.
- Actions: "Preview notification", "Save configuration".

## 4. Driver screens - extracted content

*Theme note (resolved 2026-10-27): the extracted frames are dark (`#080D16`), but the driver theme is resolved to **light** per the handoff Q1 - see [ui-ux-handoff.md](ui-ux-handoff.md) Section 12. The frames below are read with that in mind; handoff tokens are authoritative until the Figma frames are updated.*

### 4.1 Today & Route Queue (390 x 844, `#080D16`)

- Greeting "Good morning, Sarah" + ON SHIFT badge ("Tuesday 27 October  /  Shift active"), status bar clock.
- **Next stop  /  priority pickup:** St Thomas' Hospital, Westminster Bridge Road, ARRIVE BY 14:35, 2.4 miles, "Navigate to next stop".
- **Up next:** 3 stops (14:55 Drop-off London Bridge  /  15:30 Pickup Camden Clinic  /  16:10 Delivery Islington Centre) with time + type per card.
- **Connectivity banner:** *"Signal weak  /  actions sync automatically"* - the calm offline banner from [06.1b](../06-driver-app-architecture.md).

### 4.2 Active Job (390 x 844)

- "ACTIVE JOB / J-198  /  Arrive at pickup", scheduled arrival 14:35, address, "TIME AT LOCATION 00:00".
- **SLIDE TO CONFIRM ARRIVAL** with guidance "Follow site instructions before confirming arrival."
- Dispatch note ("Use main entrance  /  ring reception") and job actions (Open navigation, Call dispatch).
- GPS status inline: "accurate  /  updated 8 sec ago" - visible freshness.

### 4.3 Proof of Service & Exceptions (390 x 844)

- "J-198 / COMPLETION  /  Confirm service" - recipient details (name required here; "Optional for this job"), **photo evidence** (add delivery photo), **recipient signature** ("Sign above  /  clear and retry available"), skip/report-an-exception action.
- **Offline honesty copy:** *"Job data remains local until sync succeeds. Completion queues securely and waits for server confirmation."* - the local-intention vs. server-accepted distinction from [06.4](../06-driver-app-architecture.md), verbatim in spirit.

## 5. Customer Portal - extracted content

### Customer Portal / Order tracking (1440 x 940, `#F4F7FB`, light)

- Branded "NORTHSTAR TRANSPORT" page, "TRACKING / JOB J-198", "Your delivery is on the way", DRIVER EN ROUTE, estimated arrival 14:42.
- **Delivery progress timeline:** Booking confirmed 10:03 [x] -> Collected by driver 10:19 [x] -> On the way * (current) -> Delivered (pending) - the "pizza tracker" from [05.3b](../05-web-app-architecture.md).
- **Live route** map with "LAST UPDATED 8 SEC AGO" and honesty copy: *"Current location is approximate and updates when the driver's device reports."*
- **Privacy copy for the end-customer:** *"This link shows one job only. It does not expose other vehicles, routes or customer records."* + "Link expires automatically  /  contact the operator if you need a new link."
- Proof of service: "Completion evidence will appear here after the driver completes the stop." (No evidence uploaded yet.)
- Contact / need-help footer.

## 6. Mapping to the documentation (deltas the design introduces)

The design agrees with the documented screens; these are the concrete deltas it adds, now normative:

1. **Concrete token set** replaces the abstract "dark high-contrast" description - color/type/spacing/radius tables above are the implementation reference (also the basis for the Tailwind theme in [05](../05-web-app-architecture.md)).
2. **"Jobs & Work Orders"** appears in the workspace nav - a supporting list/detail screen for job management; it joins the roster screen as a supporting screen in [05.3](../05-web-app-architecture.md) (core demo remains the five screens).
3. **Screen dimensions** fix the layout tiers: 1440 dispatcher, 390 driver, light portal.
4. **On-canvas honesty/privacy/offline copy** (ghost pins, simulated results, local-until-synced, one-job-only) becomes the literal UI micro-copy - quoted in [05.1b](../05-web-app-architecture.md), [10.4](../10-optimization-integration.md), and the demo script ([14.2b](../14-roadmap-and-gates.md)).
5. **Notification configuration** (cadence, ETA-delta > 5 min triggers, en-route/delay/near-arrival transitions) formalizes the notification rules hinted in [05.3b](../05-web-app-architecture.md).





