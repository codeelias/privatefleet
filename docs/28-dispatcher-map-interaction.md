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
- Width `268px`; compact by default.
- Header uses icon-only expand/close controls (`26px` targets) with accessible
  labels and tooltips.
- Expanded content is capped at `min(52dvh, 430px)` and scrolls internally.
- Hidden below the `md` breakpoint so the phone map keeps its full width; the
  queue and assignment flow remain available.

### Unassigned-jobs dock

| State | Footprint | Behaviour |
|---|---|---|
| Minimised | `72 x 42 px` centred | layers icon + count only; no edge-to-edge bar |
| Open, laptop | `460 x 262 px` centred | dense vertical job rows, internal scroll |
| Open, phone | `calc(100vw - 24px)` | bottom-anchored popover, internal scroll |

- The open dock is anchored to the bottom centre, grows upward, and never
  resizes the map.
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
1366x768 closed dock  72 x 42 at x=647
1366x768 open dock    460 x 262 at x=453, y=494
1024x600 open dock    460 x 222 at x=282, y=366
390x844  open dock    366 x 262 at x=12, y=570
390x844  sheet        366 x 374, fully inside viewport
1024x600 sheet        512 x 374, body scrolls when preview expands
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
- The dock is not yet draggable or resizable; it is deliberately fixed to the
  bottom centre for predictability.
- Accessibility has keyboard, focus, labels and Escape handling; a full
  screen-reader and 200% zoom pass is still pending in the accessibility gate.
