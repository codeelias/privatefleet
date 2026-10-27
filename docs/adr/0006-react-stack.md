# ADR-0006 - React web stack (Vite, TanStack, Zustand, Tailwind, MapLibre)

**Status:** accepted (2026-10-27)

## Context
The dispatcher dashboard must feel like a premium operations console (dark command center per the reference screenshots), handle live map + timeline + drag-and-drop, and stay maintainable by one or two people.

## Decision
React + Vite + TanStack Router (typed routes) + TanStack Query (server state) + Zustand (UI state) + react-hook-form/zod (forms) + dnd-kit (drag-drop) + MapLibre GL JS + Tailwind with vendored shadcn-style primitives ([05](../05-web-app-architecture.md)).

## Consequences
- Server state lives in one cache (Query) that socket events update - one rendering projection, no bespoke store sync.
- Type safety flows from contracts through router params to queries.
- Trade-offs: TanStack Router is newer than React Router (mitigated: mainstream, v1+); dnd-kit requires a keyboard-accessibility plan, which is specified in [05.5](../05-web-app-architecture.md).

## Alternatives considered
- **Next.js:** SSR is unneeded for an authenticated dashboard; a Vite SPA is lighter to deploy (static + API) and faster in CI; rejected for now.
- **Redux Toolkit:** more machinery than this app's UI state needs; rejected.
- **MobX / signals:** viable but a smaller hiring/learning pool; Zustand covers the need with less ceremony.



