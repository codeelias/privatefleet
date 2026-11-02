# 34 - Jobs & Work Orders redesign

Date: 2026-11-02  
Scope: dispatcher web app, Jobs & Work Orders.

## Purpose

This page is the operational record of every job. It is not a second Dispatch
Board and not a dashboard. The table stays; the work is finding, understanding
and acting on a job without leaving the list.

## Implemented

### Search and filters

- Search by reference, service type, pickup/drop-off address, driver name or
  vehicle registration.
- Quick status filters with **actual counts**: All, Unassigned, Assigned,
  In progress, Completed, Failed, Cancelled.
- Select filters for service type, priority, driver and status.
- Clear button; filters combine.
- Search and filters are client-side over the loaded fleet state. No invented
  "customer" field.

### Sortable table

Columns:

```text
select | reference | service | route | schedule | priority | status | driver | actions
```

- Reference, schedule, priority, status and driver are sortable.
- Sticky header.
- 48 px row height; 12 px primary table text.
- Structured route cell:

```text
PICKUP    Buckingham Palace, London
DROP-OFF  Greenwich Market, London
+1 intermediate stop
```

- Schedule shows the actual customer pickup window, or "Not scheduled".
- Priority is independent of status: a STAT job remains STAT when assigned,
  in progress or completed.
- Driver cell includes vehicle registration.
- Rows are keyboard-selectable; View opens the detail drawer.

### Job detail drawer

A right-hand drawer keeps the list in context:

- **Overview:** reference, service, priority, status, job version.
- **Assignment:** driver, vehicle, route version, assignment state, and
  Reassign/Assign using the existing server-backed preview.
- **Journey:** ordered stops, addresses, stop status, customer windows and
  planned arrival when the published route provides it.
- **Execution history:** only recorded `arrivedAt`, `completedAt` and failure
  timestamps. If nothing was recorded, the UI says so rather than inventing
  events.
- **Proof and evidence:** fetches recorded evidence for arrived/completed stops;
  shows kind, capture time, hash prefix, byte size and image evidence when
  available. Empty state is explicit.

Escape closes the topmost layer only: the assignment sheet first, then the job
drawer. The drawer does not navigate away from the list.

### Selection and bulk actions

- Row checkboxes and select-all-visible.
- Context bar shows `N jobs selected`.
- CSV export of selected jobs.
- No bulk assignment button, because partial vehicle/time-window validation is
  not implemented yet. Assigning one job still uses the existing preview.

## Data honesty

- No customer name field exists in the contract, so none is shown.
- No creation timestamp is shown.
- No estimated stop duration is invented.
- Customer windows and planned arrivals are labelled separately.
- Proof is shown only after the API returns it.

## Responsive verification

```text
1440 x 900: full table, no page overflow
390 x 844:  table scrolls horizontally; detail drawer fills the viewport
```

Acceptance test: `apps/e2e/tests/jobs.spec.ts` - **passing**:

- find by reference
- priority filter
- open drawer
- assignment hand-off
- Escape layering
- single-row selection and export action

## Remaining

- Server-side pagination/virtualisation beyond the current 74 jobs.
- Persisted/saved views and column preferences.
- Bulk assignment with per-row validation and partial-failure reporting.
- Date-range and "requires attention" filters.
- Full job event-history API; today only stop timestamps exist.
- Delivery-performance entry point remains in the header.
- Screen-reader and 200% zoom pass.

## Files

```text
apps/web/src/features/jobs/JobsScreen.tsx
apps/web/src/app/App.tsx                 (onSelectJob wiring)
apps/web/src/features/live-map/AssignmentModal.tsx
  (Escape consumes the topmost layer)
apps/e2e/tests/jobs.spec.ts
```
