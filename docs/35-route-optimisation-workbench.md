# 35 - Route Optimisation workbench

Date: 2026-11-02  
Scope: dispatcher web app, Route Optimisation.

## Layout

The page is now a workbench, not a stack of full-width cards.

```text
Header: title | policy revision | Optimise fleet
Main column (results)                  Right rail (guardrails)
  Ready / run summary                    Dispatch policy
  Baseline                               Cost recommendations
  Proposal routes                        Driver work requests
  Approval
```

At phone widths the rail stacks below the main column. Page overflow is
suppressed: `scrollWidth == clientWidth` at 390 px.

## Policy rail

- Presets: Local, Balanced Urban, Extended.
- Compact summary when closed:
  - max km
  - travel hours
  - working hours
  - visits
- Advanced opens a two-column editor:
  - Max km, Travel hours
  - Working hours, Visits
  - Save custom limits
- Vehicle overrides are compact cards:
  - registration and driver
  - Max km / Visits
  - inherit/override text
  - Save vehicle overrides
- The earlier implicit `col-span-4` grid bug was removed; inputs no longer
  collapse to 18 px or overlap.

## Cost-aware recommendations

- Fuel/vehicle/wage rates and max detour are readable in the rail.
- Per-route estimated cost chips.
- Advisory recommendations show job reference, driver/vehicle, detour, added
  minutes and incremental cost.
- Explicitly advisory: nothing is assigned automatically.
- Empty state is explicit when no job is close enough under policy.

## Driver work requests

- Pending count in the panel header.
- Driver, vehicle, route version, policy revision and GPS age.
- Approve/Decline only for pending requests.
- Decision note shown after approval/decline.
- Approval still only records the request; assignment remains through
  optimisation, not a hidden auto-assign.

## Run and approval flow

- `Optimise fleet` runs the live OSRM + VROOM proposal.
- Result summary shows:
  - total distance and duration
  - number of routes
  - paired shipments / single-stop jobs considered
  - solver and dataset identifiers
  - expected fleet version
- Baseline card shows current published plan:
  - routes, km, minutes, stops, unassigned
- Proposal delta is visible.
- Each proposed route lists ordered stops, arrival times where returned by the
  solver, and feasibility.
- Approval is explicit; a stale policy/version returns a conflict and nothing
  publishes.

### Live run observed (not approved)

```text
Solver:   OSRM + VROOM
Proposal: 277.6 km / 675 min / 2 routes
Dataset:  greater-london-2026-10-28
Baseline: 222.1 km / 544 min / 3 routes / 90 stops / 15 unassigned
Delta:    +55.5 km, +131 min, 24 assigned stops
```

The delta is shown as-is; it is not framed as an improvement. The run was not
approved, so no route version was published.

## Responsive and verification

```text
1440x900: main + 360 px rail, no page overflow
390x844:  stacked layout, no page overflow
Advanced policy inputs: correct two-column layout
Acceptance test: apps/e2e/tests/optimization-workbench.spec.ts (pass)
```

## Remaining

- A full E2E test that clicks Optimise and asserts a proposal, with solver
  timeout handling; the manual live run is recorded above.
- Sticky approval bar for very long route lists.
- Drag-to-reorder or manual stop editing is out of scope; solver output remains
  authoritative.
- Saved policy presets / named customer policies.
- Screen-reader and 200% zoom pass.
