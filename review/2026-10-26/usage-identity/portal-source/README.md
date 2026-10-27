# Bulock Media

A private front door for Plex, Jellyfin, Live TV and Seerr. Dark, responsive, sans-serif interface; email link/code and Plex sign-in; explicit administrator control.

## Run locally

Requires Node 24. Install with `npm ci`, then `node scripts/dev-local.mjs`. Open **http://localhost:3000**. The helper creates a local-only secret in ignored `data/`, but does not configure external services or send mail. `/preview` shows the dashboard with explicitly labeled sample data and inactive service actions. All real API operations remain authenticated.

For working integrations, copy `.env.example` to `.env`, configure the required settings, and run `npm run dev`. Nuxt reads `.env` during development. The production server requires actual environment variables; Compose loads `.env` for it.

Commands: `npm test`, `npm run typecheck`, `npm run build`. Node's SQLite database lives at `DATABASE_PATH`. One application instance only; don't share its volume across replicas. Schemas are versioned in `migrations`.

## Configuration

Local authentication setup: run `node scripts/configure-auth.mjs start`, open the printed Plex authorization URL, and sign in as the server owner. Run `node scripts/configure-auth.mjs finish` to verify ownership and save the owner ID and token in ignored `.env`. The helper refuses to replace a different configured administrator. Setup expires after ten minutes. Set the dedicated Proton token in `SMTP_PASSWORD` (or `SMTP_PASSWORD_FILE`), then run `node scripts/configure-auth.mjs verify-smtp` to check TLS/authentication without sending mail. Restart the development server after configuration changes. Sign in through Plex, then verify an email on Account to enable email login for that same account.

- `APP_SECRET`: independent random value, at least 32 characters. HMACs challenges, sessions and IPTV credentials; encrypts retrievable credentials and mail jobs. Store outside database backups.
- `ADMIN_PLEX_ID`: immutable Plex ID of the owner. The first visitor never becomes administrator. Managed household profiles are not portal identities.
- `PLEX_SERVER_ID`: machine identifier of the shared server. `PLEX_OWNER_TOKEN`: owner credential for library-share reconciliation. Sign-in tokens are used transiently, not retained.
- Jellyfin public URL defaults to `https://jellyfin.bulock.house`; configure its private URL and API key. No account is auto-linked by username. Interrupted creations require explicit admin recovery by remote ID and matching name; uncertain retries never create duplicates.
- Proton sender is **media@bulock.com**. Set up that address in Proton, generate its dedicated SMTP token, and configure `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASSWORD` in `.env`. SMTP host and username have no application defaults. TLS is required. Verify sender/domain authentication and delivery before inviting real people.
- Secrets can use `NAME_FILE` instead of `NAME`, including `APP_SECRET_FILE`, `JELLYFIN_API_KEY_FILE`, `PLEX_OWNER_TOKEN_FILE`, `SMTP_PASSWORD_FILE`, and `IPTV_INTERNAL_KEY_FILE`.

## Account behavior

Plex sign-in now refreshes a separate, unverified email suggestion from Plex. When no verified email exists, the portal opens Account with that address prefilled; the user can change it, verify it by link/code, or skip. The suggestion never grants email access or merges accounts. Existing users receive it on their next Plex sign-in. Invited email-only users continue independently without a Plex identity. Ineligible email requests return no challenge and explicitly state that no email was sent; eligible requests report queued delivery, not confirmed inbox receipt. The endpoint is rate-limited, but its eligibility response intentionally distinguishes addresses with access.

Existing Plex server users can join through Plex. Everyone else needs an email invitation. A person first admitted through Plex must explicitly verify an email before using it; matching email strings never merge identities. A conflicting identity needs administrator investigation, not automatic reassignment. Sign-in links use URL fragments to keep proofs out of normal access logs and require confirmation to survive email scanners. Codes and links expire after ten minutes and share one atomic consumption record. Five bad code attempts lock that challenge. Protected changes require authentication within the last ten minutes.

Map Plex library IDs to Jellyfin library IDs in Admin. Unsupported content filters fail closed. Email-only users need explicit independent library IDs. A person removed from Plex retains portal/IPTV access, but their Plex-derived Jellyfin access is suspended. Manual Jellyfin policies remain independent. Reconciliation runs every five minutes and immediately before setup; unverified permissions never expand access. Temporary failures suspend Jellyfin and retry. A newly created remote account starts with an unknown random password, is disabled, receives policy and the user's chosen password, then is enabled. The portal does not store the chosen password.

Disabling a person immediately ends portal sessions and IPTV access, and queues remote Jellyfin disable. Remote failures appear in Admin; a failed remote request cannot be represented as completed. Re-enable restores portal access only; review and regrant other services explicitly. Seerr retains its own authentication and permissions; email-only access to Seerr must be configured there separately.

## Email alerts and news

Admin has separate **Email alerts** and **Manage news** tools. Both support drafts, previews, and simple formatting (bold, italic, lists, and links). News publishing never sends email. Published news appears in Home's three-post preview and the authenticated News archive; posts can be edited or unpublished.

Alerts use the existing SMTP configuration and go individually to all active users with verified email, or selected users. The final review lists recipients and users skipped without verified email. Sent content is immutable. Delivery history distinguishes queued, sending, sent (SMTP accepted, not confirmed inbox delivery), failed, skipped, and uncertain. Refresh the delivery panel for progress. Failed deliveries can be retried; uncertain deliveries require acknowledging possible duplication. Changed email addresses and disabled users are skipped before sending. Login mail is processed ahead of small alert batches.

An alert's reviewed audience is checked again when sending; any change requires another review. Restarting after an interrupted send preserves an uncertain result instead of replaying it. Backup restoration cancels pending/retryable alert deliveries. No scheduling, subscriptions, automatic notices, attachments, or read tracking are included.

## Service status and outage notices

Home shows cached live availability for Plex, Jellyfin, Live TV, and Seerr, separately from each person's access/setup status. Checks run from the portal every minute with a ten-second deadline; two failures at least a minute apart confirm an outage. The first failure is shown as checking availability. One successful check recovers it. Results older than three minutes, newly restarted monitoring, and missing check configuration are shown as unknown. Signed-in pages refresh status while visible; viewing a page never starts a remote probe.

Admin → **Service status** shows last check/response times and sanitized failure details, with **Check now** limited to once every 15 seconds. Create an outage or maintenance draft, review its preview, then **Publish**. Published notices appear throughout the signed-in portal and remain until **Resolve**; healthy measurements do not remove them. Editing published content updates it immediately. Notice changes require recent sign-in. Notices send no email, and maintenance windows are described in the message rather than scheduled. Resolved notices remain in admin history; only drafts can be deleted.

Checks use `PLEX_URL` + `/identity` (matching `PLEX_SERVER_ID`), public `JELLYFIN_URL` + `/health`, and `SEERR_URL` + `/api/v1/status`. The deployed Seerr 3.3 API rejects the `checkUpdateAvailable` parameter, so the probe uses the standard status route and validates its version and commit tag; any upstream version lookup follows Seerr's own behavior. Checks validate expected responses, reject redirects, and do not accept a generic login page. These are portal-origin service checks, not independent external monitoring, media playback tests, or a test of every account integration.

Live TV checks both public gateway liveness and a private diagnostic at `IPTV_GATEWAY_INTERNAL_URL/internal/health`. Compose configures that private origin as `http://iptv-gateway:3400`. The gateway diagnostic requires `IPTV_INTERNAL_KEY` and checks the private proxy's nonempty channel lineup and the configured Bulock Media viewer page without tuning a stream. The viewer check is explicitly not applicable when using the gateway's built-in landing page. Deploy the updated gateway image along with the portal; an older gateway does not provide the diagnostic contract. Keep `/internal/*` restricted to private networks at the IPTV reverse proxy (see the added router in `docs/traefik-iptv.yml`); never place the key in browser code or URLs. Public `/health` remains simple gateway liveness.

Measurements and notices use SQLite migration 7. Monitoring starts independently of mail/reconciliation jobs. Backup restoration clears measurements and returns published notices to drafts for review, so old outages are not presented as current. No existing service grants or access permissions change.

## IPTV deployment boundary

The gateway in `integrations/iptv` extends the existing IPTV delivery stack without modifying the proxy's private tuner behavior. It is the **only public entry point** for `iptv.bulock.house`. Stream bytes never pass through the portal.

Public routing:

| Host/path | Destination |
| --- | --- |
| `media.bulock.house` | portal port 3000 |
| `media.bulock.house/api/internal/*` | deny at public reverse proxy |
| `iptv.bulock.house/*` | gateway port 3400 |
| Existing IPTV proxy/player ports | private only; not publicly routed |

Active portal users choose **Enable Live TV** for immediate access. Existing pending requests on enabled accounts activate once when migration 8 runs at startup. Disabled accounts remain blocked. Revoked access can only be restored through **Admin → People → Manage → Restore Live TV**; self-service activation cannot override revocation. Repeated activation preserves existing links and viewing sessions.

The gateway verifies every new request through the private portal API. Native app links use `/media/v/<credential>/lineup.m3u` and `/xmltv.xml`. Browser access uses an HttpOnly host-scoped session minted by a single-use 60-second handoff. Both modes enforce the same grant. Stream authorization is rechecked every 30 seconds with a 5-second timeout; failure or revocation aborts connections. Redirects from upstream are rejected. M3U and HLS links are rewritten into protected paths, including relative key/segment URIs within the existing proxy's route format. Nested upstream URLs are encrypted and bound to the requesting credential, so provider credentials are never exposed and users cannot supply arbitrary `upstream` URLs. Native links are bearer credentials: sharing them shares access until rotation or revocation.

To show account names in IPTV Proxy's Usage tab, set the same independent `IPTV_USAGE_IDENTITY_SECRET` on the gateway and IPTV Proxy, then restart both services. The gateway uses the portal's verified account ID and name to set `X-IPTV-User-Id` and `X-IPTV-User-Name` on private upstream media requests, with `X-IPTV-Identity-Secret`; it never forwards client-supplied identity headers. The ID and name are percent-encoded UTF-8. Without this opt-in setting, IPTV Proxy continues to show IP-based usage. These headers are display metadata, not playback authorization.

`IPTV_UPSTREAM_URL` must identify the private proxy origin whose URLs appear in playlists; verify actual output before cutover. Do not point it at the gateway itself. The original proxy landing page exposes setup/admin links. Production now routes through the gateway to the private browser viewer. By default the gateway serves a protected setup/download landing page. Optionally set `IPTV_VIEWER_URL` to the private patched Nuxt viewer if you choose to deploy the existing local player. Configure containers on a shared private network or supply private reachable addresses. Existing Plex/Jellyfin tuners use the original private proxy port, never a public bypass header. The gateway deliberately does not expose proxy administration or arbitrary URL fetch endpoints. Artwork is omitted to avoid revealing upstream URLs. Text manifests/guides are bounded to 24 MiB.

The browser viewer is maintained in the separate `iptv-web` repository. Place its checkout beside this repository (`../iptv-web`), or set `IPTV_VIEWER_BUILD_CONTEXT` before building Compose. It loads only `/media/lineup.m3u`, disables arbitrary-URL fetching, and offers compatibility mode through the proxy transcoder. Browser codec support varies. Supported gateway routes include `/stream/<source>/<name>`, `/transcode/<source>/<name>`, and lineup/guide routes. See [deployment status](docs/deployment-status.md) for verified live behavior.

Reverse-proxy access logs for IPTV must omit credential-bearing paths/query strings; disable logging on `/media/v/`. Never cache authenticated responses or forward user-supplied identity headers to the private services. Do not expose the portal's internal API key to clients.

## Docker

Configure `.env`, then `docker compose build` and `docker compose up -d portal`. Portal binds host loopback port 3300. Once the proxy/player topology has been verified, `docker compose --profile iptv up -d` starts the gateway on loopback port 3400. Host reverse proxy terminates TLS; if it is containerized, attach a private network instead of exposing ports globally. `APP_URL` must exactly match the browser origin for mutation checks.

## Backup and restore

Stop the portal before copying the SQLite database and its WAL/SHM files as one consistent set, or use SQLite's online backup facility. Preserve `APP_SECRET` separately with restricted permissions. Test restoration offline.

Before serving a restored database, run `npm run restore-invalidate` (inside the production container: `node --experimental-strip-types scripts/invalidate-restored.ts`). It destroys restored sessions, challenges, invites, handoffs, viewer credentials and pending email, revokes all IPTV grants, disables users, and queues Jellyfin suspensions. Only the explicitly configured `ADMIN_PLEX_ID` is re-enabled for administrative recovery. Keep public access closed until remote suspensions complete and access has been reviewed. Old email proofs and copied playlists must fail. Do not simply start an old database against public traffic.

## Production acceptance

Local verification on 2026-10-23: 25 core/security tests and one production HTTP integration test pass; TypeScript checks and production build pass. Desktop and phone layouts were inspected in the browser. Docker images were subsequently built and verified on Plex; see deployment status for live checks. Production dependency audit reports zero vulnerabilities after updating Nodemailer. The full development dependency audit reports seven high advisories in the Nuxt/listhen/node-forge build-tool chain; node-forge is absent from the generated standalone server. Keep the development server loopback-only and monitor upstream fixes; do not deploy the development toolchain.

No production deployment or real invitations are performed by building this repository. Before cutover, verify actual DNS/reverse-proxy rules, deployed viewer identity, private tuner consumers, Plex sharing API shapes/restrictions, Jellyfin library policy behavior, and Proton delivery. Then pilot one Plex user and one invited email-only user. Check activation, admin restoration, removal, active-stream revocation, magic links on another device, keyboard/mobile behavior, and recovery from a remote outage. Do not open IPTV publicly until direct backend paths are unreachable externally.
