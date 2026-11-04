# October 26 local changes deployment

Deployed to `plex`, container `iptv-proxy`, at the user's request to deploy all local changes.

Image: `bulock-iptv-proxy:all-local-20261026`.
Image ID: `sha256:d6d435abf5287538c4039c0f505ec6888c37996ef3ccb6c89ccc33aba25cc842`.

Includes the channel editor's visible close button, complete discovered stream/guide choices, persistent manual assignments, persistent SQLite admin sessions, and the earlier local MCP provider and deinterlacing changes. Root dependency manifests match the previous production image, so the image reuses its installed dependencies and replaces the complete application runtime and admin assets.

The UI was compiled with the Vite API from the repository root into an isolated release directory. No tracked `public/admin` files were changed. The build retained the existing Preview CSS `:deep` warnings and bundle-size warning.

Another chat began usage-identity implementation during packaging. Its runtime changes were excluded from this tested release. Its two new unit tests and one integration test were excluded when rechecking the immutable deployment snapshot. The concurrent work was left untouched in the shared workspace.

## Validation

- 220 release unit tests passed: `release-unit.log`.
- 226 release integration tests passed. Three existing failures remain: canonical no-map binding classification, canonical rename exact-object expectation, and OAuth localhost versus 127.0.0.1 discovery metadata. All three previously reproduced on unchanged HEAD: `../channel-editor-baseline.log`. Release results: `release-integration.log`.
- Targeted ESLint and diff checks passed before packaging.
- Candidate used copied configuration and an integrity-checked online SQLite backup, with port 34407 bound to loopback.
- Candidate and live HTTP checks preserved all 27 published channel IDs and returned 1,314 programmes over 48 hours, including 64 for ESPN: The Ocho.
- Candidate and live verified all 57 application runtime source hashes.
- Candidate session-store smoke test wrote an unauthenticated test session, restarted the container, verified the saved session, and removed it.
- Live database integrity is `ok`; migration `006-admin-sessions` is applied.
- Production Docker health is `healthy`.
- Public HTTPS admin loads with HTTP 200 after redirects. Its JavaScript SHA256 is `818e44392dd1627a914bfb2479602106844f29a9614e288f6514c5883e8542bc`, matching the isolated build exactly.
- Unauthenticated public canonical-channel API returns 401.

## Recovery

Private release directory: `/opt/live-tv-releases/20261026-all-local`.
Backup: `before-promotion.sqlite` in that directory.
Original container configuration: `original.json` in that directory. Keep it private.
Rollback container: `iptv-proxy-rollback-all-local-20261026`, stopped and retained.
Previous image: `bulock-iptv-proxy:mcp-providers-20261025`.

For an application rollback, stop and rename the current container, rename the rollback container to `iptv-proxy`, and start it with its existing persistent mounts. Do not restore the database solely to roll back the image. The deployment script automatically restores the previous container if promotion verification fails.

Source, manifests, build assets, and deployment script are retained on the host. Local implementation changes remain uncommitted; no push was requested.
