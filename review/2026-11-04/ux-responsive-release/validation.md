# Final responsive UX pass — 2026-11-04

Preserves the current dark theme and orange accent. Only admin code is changed.

## Reproduced and fixed

- The player dialog measured 329px wide in a 320px viewport and extended above
  and below a 568px-tall screen. Its inherited minimum size did not account for
  dialog padding. App dialogs now use a border-box viewport limit and scroll
  vertically. The fixed dialog measures 296px wide with no horizontal overflow.
- Tablet and desktop tables expanded the main grid item to their intrinsic
  width. At 768px, Activity overflowed the document by 1341px. Allowing the main
  item to shrink lets the tables use their existing responsive behavior.
- Playback failure messages could be constrained to the video overlay on small
  screens. Mobile recovery content now sizes naturally, with wrapping actions.
  The synthetic failure panel has no internal overflow at 320px. Inline video
  playback is requested with `playsinline`.
- Global, unscoped `:deep()` selectors prevented several responsive toolbar
  rules from taking effect. These now use normal descendant selectors.
- Mobile controls used text as small as 12.75px. Native and shadow controls now
  use 16px text on phones, retaining the existing page typography.
- Built-in dialog close buttons had no glyph: their dynamic icon import
  produced an empty, zero-size icon. App and review dialogs now use a shared
  heading with an inline SVG close icon and a 44px native button.
- Cancel in the create/duplicate lineup prompt rendered as a native submit
  button. Cindor's Vue wrapper assigns a property, while the core component
  requires an explicit type attribute to distinguish a non-submit action in a
  form. The prompt now forwards that attribute explicitly.

## Verification

- All eight sections checked at 320x568, 390x844, 768x1024, and 1280x800 in the
  isolated fixture: all 32 checks report zero document horizontal overflow.
- Phone channel editor, new-lineup prompt, unsaved-change guard, review dialog,
  and discard confirmation exercised. Drafts survive section changes.
- Before the Cancel fix, a browser assertion failed because native type was
  `submit`, and cancellation created one disposable fixture lineup. After a
  fresh load, type is `button`; mouse and Enter cancellation both close the
  prompt without changing the lineup count or adding any mutation request.
- 235 non-integration tests pass. The first sandboxed run had one local socket
  EACCES failure; the same suite passed with loopback access enabled.
- Production lineup/settings were not edited during the audit. Stream preview
  was opened and closed. Responsive checks use browser viewport emulation,
  not physical iOS/Android hardware.

## Repeat the browser regression

Run `test/fixtures/admin-channels-preview.mjs` with the installed x64 Node/Vite
runtime and visit `http://127.0.0.1:5178/admin/`. Open Lineup settings, then New
lineup. Inspect Cancel's native shadow button type, click Cancel, and repeat
using Enter. Both must close without adding a lineup. `/__fixture` exposes the
local-only request log; no POST to `/api/output-profiles` should be added.

At phone width, open Preview and Watch MeTV. The fixture deliberately returns a
stream error. Verify the dialog is within the viewport, Retry is accessible,
and the guide and diagnostics can be reached by scrolling. Repeat with the
tablet Activity screen and ensure the page itself does not scroll sideways.
