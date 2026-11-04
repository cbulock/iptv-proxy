# Responsive UX patch — verified live 2026-11-04

Source: `d21348f29bd5410833a50b89d2d735c2146da273`, pushed to
`codex/remaining-guide-work`.

Prepared image: `bulock-iptv-proxy:ux-responsive-20261104`.
Image ID: `sha256:def90c74b6d91f5cb787541b951e550b3c24f9eed19d9c9627259cece50177eb`.

This supersedes the admin assets from `ux-20261104`. It packages only static
admin files on the unchanged production backend image. The isolated build used
the Vite API from the repository root with an immutable git archive; tracked
`public/admin` files were not changed. The bundle-size advisory remains; the
invalid global `:deep()` warnings are resolved.

## Promotion

`promote-assets.py` staged and hashed every asset, backed up the current UI, and
atomically replaced each file with HTML last. The container ID and start time
were unchanged; all 29 exact channel IDs matched before and after. No backend
restart, configuration edit, or database migration was performed.

Private release directory: `/opt/live-tv-releases/20261104-ux-responsive`.
Previous UI: `/usr/src/app/public/admin-before-ux-responsive-20261104`.

The running container still identifies as the original backend image, with the
new UI in its writable layer. Restart preserves it. Future container recreation
must use the prepared responsive image above (or reapply these verified assets).
To roll back this patch, copy the previous UI directory over the active
`/usr/src/app/public/admin` directory; no database restore or restart is needed.

## Final verification

- Public HTTPS HTML, JavaScript, and CSS returned 200 with exact manifest hashes.
- Docker healthy, unchanged start time, SQLite integrity `ok`.
- All eight deployed sections at 320, 390, 768, and 1280px: zero document overflow
  in all 32 checks. Browser viewport emulation; no physical-device testing.
- Live 320px prompt: visible 44px close button with a 20px SVG, correct native
  Cancel type, closes without adding a lineup. Only Default Output remains.
- Live 320px player with populated guide: dialog 296px wide, 544px high in a
  320x568 viewport, zero horizontal overflow, inline-video attribute present.
  Preview was stopped after verification.
- Fresh live browser inspection recorded no console errors.
- 235 tests pass, scoped ESLint and diff checks pass, independent static review
  found no actionable regressions. See [validation](validation.md) for the
  failing-before/passing-after Cancel reproduction and responsive checks.

JavaScript SHA256: `b6f8a41db96588944487704ffbdd0cdcf741e09072b58cd00dd98e09020b7f67`.

CSS SHA256: `214b3824c24bb44ca6eac3c5c633fdf0569393ebe5953df55e3d683a99475666`.
