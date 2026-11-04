# Admin UX release — 2026-11-04

Superseded by the [responsive UX patch](../ux-responsive-release/release.md).
Use its newer image for future container recreation.

Source commit: `13b671e63ec7f3fc8d1c42573dd8a91f475dd2a9` on `codex/remaining-guide-work`.

Prepared immutable image: `bulock-iptv-proxy:ux-20261104`.
Image ID: `sha256:09717a3ea7e9ff8d48abf19f479a74cbefeeac9e7b8ec32bf16837a4680a6c20`.

Only `public/admin/` is replaced in the deployed image. The base is the existing
production backend, `bulock-iptv-proxy:usage-heartbeat-20261026`, image ID
`sha256:d05f4f1a6cce8ac34642416f9024ffec275bc556e24a2c78cd99a3a8416501c9`.
No server, dependency, migration, or configuration changes are packaged.

## Packaging and checks

`build.mjs` uses the Vite API from the repository root, compiling an immutable
`git archive` export of the source commit into this isolated release directory.
It preserves stable `assets/index.js` and `assets/index.css` names. It never runs
the admin directory's build command or changes tracked `public/admin` files.
The existing global `:deep` CSS and bundle-size warnings remain.

- Non-integration tests: 235 passing.
- Integration tests: 238 passing; the two canonical-routes failures reproduce
  on unchanged baseline `887533c` (lines 169 and 480).
- Targeted ESLint, Vue script/template/style compilation, and diff checks pass.
- Candidate uses copied configuration and an integrity-checked online SQLite
  backup, listening only on loopback port 34409.
- Candidate and production checks compare channel identities and every deployed
  asset's SHA256; HTML, JavaScript, and CSS are also checked over HTTP.

JavaScript SHA256: `21b3e32c78fb1e69ee6d70753cab19b7846008293ac452c78a097d7dd9a6ff57`.

CSS SHA256: `2186f020253cae2b2180f00a2d5724cf12f2336834658969d3bc811520772ee0`.

## Startup discovery observation

The initial live comparison found a 29th channel, H & I, after startup discovery.
All original 28 channel identities remained present. The strict equality gate
automatically restored the prior image. That unchanged backend also emitted the
29-channel lineup, confirming the addition is existing discovery behavior, not
the new admin assets. A subsequent isolated candidate had the same 29 channels, but startup regenerated
the H & I source and canonical IDs. The other 28 IDs matched. Source-sync and
canonical-service hashes matched production exactly. No lineup entries were
manually edited to make a deployment check pass.

## Final promotion and live verification

Because this release changes only static admin assets, the final promotion used
`promote-assets.py` in the existing healthy container. It stages and verifies all
files, backs up the entire previous admin directory, then atomically replaces
individual files with the entry HTML last. This avoids Docker overlay filesystem
restrictions on renaming lower-layer directories. The backend container ID and
start time were unchanged by this final promotion; all 29 channel IDs matched
before and after.

The running container retains its original base image identity and the new admin
files in its writable layer. A Docker restart retains those files. Any future
container recreation must use the prepared release image above (or reapply the
verified assets), rather than recreating from the old base tag alone.

Final checks: Docker healthy; database integrity `ok`; 29 channels; public HTTPS
HTML, JavaScript, and CSS all HTTP 200 with exact manifest hashes. Signed-in
browser inspection confirms Channels as the landing screen, 29 included channels,
62 excluded channels, zero attention issues, and the Activity interface. No
browser warnings or errors were captured during the final inspection.

## Recovery

Private host directory: `/opt/live-tv-releases/20261104-ux`.

`first-before.sqlite` and `first-before-container.json` preserve the original
pre-release state. `before.sqlite` and `before-container.json` hold the final
deployment's backup and container configuration. Keep these files private.

The original container was restored by the guarded rollout and remains live.
Its prior UI files are retained at
`/usr/src/app/public/admin-before-ux-20261104`. To roll back only the UI, copy
that directory’s contents over `/usr/src/app/public/admin` inside the container
and verify the old asset hashes. No backend restart or database restore is
required. The staged new assets also remain available inside the container.

Deployment status: verified live on 2026-11-04.
