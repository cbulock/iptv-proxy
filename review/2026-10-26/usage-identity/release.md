# Usage identity production release — 2026-10-26

Deployed optional, shared-secret-backed viewer identity to IPTV Proxy and the
Bulock Media portal/gateway on `root@plex`. The proxy remains usable without
identity headers. The gateway now supplies its verified user ID and friendly
account name on protected media requests.

## Release assets

- Proxy image: `bulock-iptv-proxy:usage-identity-20261026`
- Portal image: `media-user-center-portal:usage-identity-20261026`
- Gateway image: `media-user-center-iptv-gateway:usage-identity-20261026`
- Proxy release: `/opt/live-tv-releases/20261026-usage-identity`
- Portal release: `/opt/media-user-center-releases/usage-identity-20261026`

The 64-character random hex `IPTV_USAGE_IDENTITY_SECRET` was generated on the
production host and retained in root-only
`/opt/media-user-center-releases/usage-identity-20261026/identity-secret`.
The gateway reads it from `/opt/media-user-center/.env`; the proxy container
receives the same value as an environment variable. The value is absent from
this release record and repository files. Both the secret file and `.env` are
mode `0600`.

## Verification

- Local focused proxy and portal tests passed before staging (see the
  implementation turn); all three production images built successfully.
- Isolated candidates passed health, exact source/image checks, 28-channel
  lineup preservation, admin bundle hash, shared-secret acceptance/rejection,
  and environment matching.
- Live proxy, portal, and gateway passed the same checks. Both SQLite databases
  passed `PRAGMA integrity_check`.
- Public portal and gateway health returned HTTP 200; an unauthenticated public
  playlist returned HTTP 403.
- The existing browser viewer container was not replaced. Isolated candidate
  containers were stopped after verification.

The first cutover attempt stopped at Compose invocation from the wrong working
directory. The second stopped because the verifier checked loopback for the
portal's host-IP-only port. Production applications were restored after each
attempt; preflight checks confirmed the prior source, environment, and image
IDs before retrying. The corrected third cutover completed successfully.

## Rollback

Root-only pre-release `.env`, source, container metadata, and online SQLite
backups are retained under the two release directories. The prior proxy
container is `iptv-proxy-rollback-usage-identity-20261026`; prior portal and
gateway image tags end in `:before-usage-identity-20261026`. Image-only rollback
does not require restoring databases. If rolling back the portal/gateway,
restore their previous `.env` and six changed source files first, then retag
the prior images as `:latest` and recreate both services with
`compose.production.yaml` from `/opt/media-user-center`.
