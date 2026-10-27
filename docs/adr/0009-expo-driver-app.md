# ADR-0009 - Expo driver app from day one (web target for the demo)

**Status:** accepted (2026-10-27) - see the Phase 1 note below.

## Phase 1 note (2026-10-27)

The demo transport is Vite + react-native-web rendering the same React Native components; Expo CLI / EAS takes over for the native pilot builds in Phase 3. The architectural commitment (one RN codebase, web for the demo) is unchanged.

## Context
The demo needs driver screens on a tablet; the pilot needs background GPS, which browsers cannot reliably provide. Building a PWA driver app first and a native app later would duplicate the driver UI.

## Decision
One Expo (managed) codebase for the driver app. Phase 1 runs it via `expo export --platform web` on the demo tablet (simulated GPS); Phase 3+ ships native builds (EAS Build) with expo-location and the offline SQLite queue ([06](../06-driver-app-architecture.md)). The map is a platform-split adapter (`MapView.tsx` / `MapView.web.tsx`).

## Consequences
- Driver UI is written once; the demo's driver screens are the pilot's driver screens.
- Windows dev machines never need a native toolchain (EAS cloud builds); iOS is possible without a Mac.
- Trade-offs: react-native-web adds a layer on web; background location remains subject to OS policies (expectations set with the pilot fleet, [14.4](../14-roadmap-and-gates.md)); the map adapter is the one platform-forked component.

## Alternatives considered
- **PWA first, rewrite native later:** duplicate UI and behavioural drift between demo and pilot; rejected.
- **Flutter:** excellent tech but a second language and ecosystem for a TypeScript-first team; rejected.
- **React Native CLI (bare):** more control, far more toolchain upkeep; managed Expo covers our needs.



