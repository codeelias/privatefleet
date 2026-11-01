# 28 - Dispatcher live-map interaction

Date: 2026-11-01  
Scope: dispatcher web app, Live Operations map.

## Design intent

The map is the workspace, not a background behind generic cards. Map chrome
must feel like an instrument overlay: inset, quiet, bounded, and removable.

Three rules:

1. **Never span the map edge to edge.** Panels are inset from the map frame.
2. **Never grow without a height contract.** Every expanded panel scrolls
   internally and leaves the map visible.
3. **The dock is a taskbar, not a footer bar.** Minimised it is a small centred
   icon; opened it is a bounded popover above the dock.

## Layout

### Selected-vehicle HUD

- Inset `20px` from the map's top-left interior.
- Width `250px`; compact by default.
- Header uses icon-only expand/close controls (`26px` targets) with accessible
  labels and tooltips.
- Expanded content is capped at `min(52dvh, 430px)` and scrolls internally.
- Hidden below the `md` breakpoint so the phone map keeps its full width; the
  queue and assignment flow remain available.

### Unassigned-jobs dock

| State | Footprint | Behaviour |
|---|---|---|
| Minimised | `46 x 46 px` centred | taskbar-style layers icon, count badge and running underline; no edge-to-edge bar |
| Open, laptop | `440 x 275 px` centred | 3 dense job rows per page, fixed pager footer |
| Open, phone | `calc(100vw - 24px)` | bottom-anchored popover, 3 rows per page |

- The open dock is anchored to the bottom centre, grows upward, and never
  resizes the map.
- The total count is the badge; the list exposes exactly 3 jobs per page with
  `1-3 of 15` and Previous/Next, so the visible rows never contradict the count.
- Job rows show reference, priority, pickup and drop-off, and an Assign action
  in one compact line pair; no large generic cards.
- `Esc` closes the assignment sheet; the sheet locks background scroll.

### Assignment sheet

- Desktop: centred, `max-width: 512px`, `max-height: calc(100dvh - 24px)`.
- Phone: bottom sheet, `calc(100dvh - 12px)`, rounded top corners.
- Header and action footer are fixed; only the driver/preview body scrolls.
- If the ETA cascade grows, the body scrolls while Cancel/Confirm stay visible.
- Focus moves into the dialog on open; Escape and Cancel close it.

## Responsive evidence

Measured in Chromium against the deployed build:

```text
map frame starts at x=12, y=141 on 1893x879; HUD starts x=32, y=161 (20 px inside)
1024x600 map          x=12, y=179.5, 1000 x 408.5
1024x600 HUD          x=32, y=199.5, 250 x 130.75 (20 px inside)
1024x600 dock         x=292, y=297, 440 x 275; bottom 16 px inside the map
1893x879 closed dock  46 x 46, centred
1893x879 open dock    440 wide, centred, pager 1-3 of 15
390x844  open dock    366 x 275, bottom 16 px inside the map
390x844  sheet        366 x 374, fully inside viewport
```

The 1024x600 preview sheet's body scrolls (`client 447`, `scroll 479`) while
the footer remains fixed.

## Files

- `apps/web/src/app/App.tsx` - map HUD, dock, dense queue integration.
- `apps/web/src/features/live-map/AssignmentModal.tsx` - bounded sheet.
- `apps/web/src/features/dispatch/JobCard.tsx` - dense draggable row variant.
- `apps/web/src/index.css` - `pf-map-hud`, `pf-map-dock`, `pf-modal-sheet`.

## Known limits

- The vehicle HUD is hidden on phone widths by design; a future mobile sheet
  can expose it without covering the map centre.
- The pager is fixed at 3 jobs; a future density setting can expose 2/3/5.
- The dock is not yet draggable or resizable; it is deliberately fixed to the
  bottom centre for predictability.
- Accessibility has keyboard, focus, labels and Escape handling; a full
  screen-reader and 200% zoom pass is still pending in the accessibility gate.
