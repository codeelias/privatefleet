# 33 - Dispatch Board redesign

Date: 2026-11-02  
Scope: dispatcher web app, Dispatch Board only.

## What changed

The Board is now a split dispatch workspace rather than a dashboard with a
card tray underneath.

### Schedule (primary surface)

- Driver/vehicle column is sticky on the left.
- Timeline is 06:00-18:00 with hour grid and a current-time line only when the
  current time is inside the shift.
- Planned pickups are rendered as compact chips at the route's
  `plannedArrivalAt`.
- Chips are packed into five visual rows using interval overlap, so same-time
  pickups do not collide.
- Chip text: job reference and planned pickup time; the tooltip includes the
  drop-off time and any risk.
- Chips are packed into five visual rows by interval overlap, then ordered by
  planned pickup.
- The driver column is sticky; the timeline auto-scrolls near the earliest
  planned pickup so phones do not open on empty 06:00 space.
- Customer service windows are deliberately **not** used as job duration. They
  are two-hour windows and overlap by design.
- Completed and cancelled jobs are excluded from the driver lanes.

### Window risk (correctness)

A job is flagged only when a published stop's `plannedArrivalAt` falls outside
that stop's promised `windowStart`/`windowEnd`.

```text
risk = plannedArrival < windowStart OR plannedArrival > windowEnd
```

This replaces the false "overlap" count caused by comparing customer windows.
In the current Northstar data the Board shows **12 window risks**, not 183
false conflicts.

### Job queue (right side)

- 330 px panel on desktop, 58 px collapsed rail.
- Stacks below the schedule below `lg`.
- The driver column is 150 px on phones and 210 px on larger screens.
- Compact items show reference, priority, pickup -> drop-off, customer window,
  stop count and service type.
- Search by reference/address; filters for All / STAT / Urgent.
- Priority-first ordering.
- Click opens the existing assignment preview; drag remains available through
  the grip handle.
- Queue collapse/expand preserves the schedule width.

### Visual semantics

| Signal | Treatment |
|---|---|
| STAT | Red border/text |
| Urgent | Amber border/text |
| Standard | Neutral grey |
| Window risk | Red ring + `!` |
| Current time | Red vertical line, only inside shift |
| Queue filter active | Orange token |
| Job type | Small uppercase metadata |

Saturated orange is no longer the default for every scheduled job.

### Header

- Actual server date, not a hard-coded board date.
- Clear "Day shift · Greater London" context.
- Metrics: unassigned, on shift, at risk (open alerts), window risks.
- No static "TUE 27 OCT" legend.

## Responsive evidence

```text
1440 x 900: split workspace, no page overflow
1024 x 600: split workspace, no page overflow
390 x 844:  schedule above queue, no page overflow (scrollWidth == 390)
queue row click: assignment dialog opens
acceptance test: tests/dispatch-board.spec.ts (pass)
```

The schedule scrolls horizontally on phones; the driver column stays fixed.

## Remaining UX work

- Assignment preview and **Undo** after commit.
- Resizable queue divider (currently fixed/collapsible).
- Zoom / Fit day / Jump to now controls.
- Selected-job detail panel and keyboard assignment flow.
- Workload/capacity bar per driver, once a defensible capacity model exists.
- Screen-reader and 200% zoom pass.

## Component boundaries

```text
Board.tsx
  Metric
  QueueItem (draggable; click to assign)
  DriverLane (droppable; planned chips)
  DispatchBoard (filters, lane models, split layout)
App.tsx
  passes onSelectJob={openAssignment}
```

No new dependencies were added.
