# Channels redesign release

Deployed 2026-10-25 (America/New_York) after the user requested commit, push, deployment, and integration of the latest changes. The user explicitly approved a one-time isolated admin build; tracked `public/admin` assets were not changed.

## Source

- Channels redesign: `2de3e18`.
- Published-guide retention: `c5c2def`.
- Latest `origin/main` (`1280d0a`) merged in `2828938`, including its dependency updates.
- Latest `origin/codex/epg-retention` (`987c8ba`) merged in `5203a3e`. Resolution preserves the newer empty-lineup condition and published-guide snapshot/icon protection.
- Deployed web-guide name fallback incorporated in `6913077`, with a regression test observed failing before the change and passing afterward.
- All changes pushed to `origin/codex/remaining-guide-work`. No force push or merge to main.

Application archive: `6913077`. Subsequent commits contain deployment procedure and release evidence only.

## Build and validation

Installed exact root and admin lockfile dependencies. Generated the admin bundle through the Vite API from the repository root into an isolated release directory. Built the complete Docker image from the committed archive plus these assets. The initial exploratory bundle was replaced with the exact-lockfile Vite 8.0.16 bundle before deployment.

- 215 non-integration tests passed.
- 218 integration tests passed. The same three canonical/OAuth failures documented in `channels-ux-validation.md` remain; all three also reproduced against an unchanged pre-redesign HEAD archive.
- Guide integration tests: 8 passed after merging overlapping retention changes.
- Web-guide projection tests: 4 passed.
- Targeted ESLint and diff checks passed.
- Build completed with existing unscoped `:deep` warnings in Preview/toolbar CSS and a bundle-size warning.
- The exact production asset was checked by SHA-256 on the candidate, live localhost endpoint, and public HTTPS endpoint. A fresh authenticated browser inspection of the deployed bundle was not completed; the earlier desktop/mobile fixture checks remain the visual evidence.

## Deployment

Host: `plex`; service: `iptv-proxy` on port 34400.

Image: `bulock-iptv-proxy:channels-20261025`

Image ID: `sha256:27437fd51b839c5430030c2a43136a5ef1f34e51d4786fb293e5bcc75758f2ed`

Release directory: `/opt/live-tv-releases/20261025-channels` (private to root).

The candidate used copied configuration and an integrity-checked online SQLite backup, with port 34405 bound to loopback. It passed verification before promotion. The deployment script took another online backup immediately before cutover, retained the original container, and would automatically restore it on failed live verification. Candidate is now stopped.

Live checks passed:

- Docker health is healthy.
- Published membership is unchanged: 26 channel IDs.
- The 48-hour guide returned 1,183 programmes, including 58 for ESPN: The Ocho.
- All 66 deployed application/asset files match the release archive.
- Environment, command, entrypoint, user, working directory, mounts, published ports, and restart policy match the prior container.
- `https://iptv.bulock.house/admin/` returns 200; its JavaScript bundle matches the release exactly.
- Unauthenticated canonical admin API returns 401.

The complete source was deployed, including newer repository backend work; no provider configuration or channel settings were manually changed for verification.

## Rollback

Prior container: `iptv-proxy-rollback-channels-20261025`.

Prior image: `bulock-iptv-proxy:web-guide-fallback-20261025` (`sha256:761fc0253ff8a3ba3a7ad41dbe2d74f2face6275f896b7cb19553fe6417498e0`).

Backup: `/opt/live-tv-releases/20261025-channels/before-promotion.sqlite`; original container configuration: `original.json` in the same private directory. Keep these private because they include runtime configuration/data.

For an application rollback, stop the new container, rename it to a distinct failed-release name, rename the retained prior container to `iptv-proxy`, then start it. Preserve the live config/data mounts. Do not restore the database merely to roll back the application image.

See `deploy-channels.py` for the exact candidate, backup, verification, promotion, and automatic rollback procedure.
