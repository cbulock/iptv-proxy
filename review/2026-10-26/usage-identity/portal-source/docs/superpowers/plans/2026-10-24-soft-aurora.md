# Soft Aurora Implementation Plan

**Goal:** Apply the user's selected Soft Aurora background site-wide at 35% intensity and 1.7× speed.

**Design:** Preserve the sage, teal, and violet canvas ribbons and central dark shading from the approved interactive preview. Keep existing page content above the effect. The effect is decorative, ignores pointer events, and shows a still frame when reduced motion is requested.

**Architecture:** A shared Vue component owns canvas rendering and browser lifecycle listeners; the application shell mounts it once. No new dependencies or service changes.

**Tech stack:** Nuxt, Vue, TypeScript, Canvas 2D.

## Implementation

- [x] Create `app/components/AuroraBackground.vue` using the approved drawing algorithm, intensity `0.35`, speed `1.7`, and initial time `8`.
- [x] Mount once in `app/app.vue`, beneath the shared shell using an isolated stacking context.
- [x] Stop animation for hidden tabs and reduced motion; resume without time jumps, resize correctly, and clean up listeners/frames on unmount. Retain the plain background if Canvas 2D is unavailable.
- [x] Run type checking and the production build; inspect the actual preview and login pages in the browser at desktop and mobile sizes. Check console errors and content interaction. This decorative change does not need implementation-mirroring unit tests.

## Review focus

Check server rendering (no browser globals before mount), reduced-motion changes, visibility changes, high-DPI canvas sizing, and stacking/pointer behavior. Keep the prototype controls out of the application.

## Verification

- Nuxt prepare and scripts/verify-types.mjs passed.
- Nuxt production build passed (existing chunk-size and node:sqlite externalization notices).
- Browser inspection passed for the built portal's preview and mobile login: background renders behind content; navigation and input remain usable; no console errors.
- Independent source review found no actionable issues, including SSR, reduced motion, visibility, cleanup, and canvas sizing.
- Deployed to production on 2026-10-24 after user approval. Docker build, isolated candidate checks, live container health, public HTTPS health, and public login browser inspection passed. See `docs/deployment-status.md` for release and rollback details.
