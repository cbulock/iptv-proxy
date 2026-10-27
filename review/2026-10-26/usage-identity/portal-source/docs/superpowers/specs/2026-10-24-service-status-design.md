# Live service status and outage notices

Date: 2026-10-24
Status: approved by the user; implemented and verified locally (not deployed)

## Intent and agreed direction

Help signed-in users distinguish a service outage from an account or device problem. Give the administrator timely diagnostics and a way to explain maintenance or problems that automated checks cannot detect.

The user selected the combined approach: automatic checks for Plex, Jellyfin, Live TV, and Seerr, plus administrator-written notices. Checks run every minute, repeated failures precede an outage, and stale results become unknown. Availability stays separate from a person's access and setup status.

## Approaches

1. Automatic checks alone detect unreachable services but cannot explain maintenance or individual playback problems.
2. Manual notices alone provide context but require the administrator to detect each problem.
3. Combined checks and manual notices provide both detection and explanation. This is the user's selected approach.

The details below are proposed implementation choices, rather than additional decisions already made by the user.

## User experience

Home gains a compact service-status panel covering all four services. Use text and icons as well as color. Existing service cards retain their account/setup labels and launch actions; an outage does not revoke access or disable an otherwise available launch action.

An active outage or maintenance notice appears below the navigation throughout authenticated pages. Notices identify affected services, title, explanation, and last update. Healthy automatic checks do not dismiss a manual notice. A manual notice never overwrites the measured result: for example, show "Responding" alongside "Maintenance" when appropriate.

Automatic unavailability produces a concise system notice per affected service. When a manual notice already covers that service, show the automatic availability within that notice rather than a second banner. Unknown results appear in the status panel, without asserting an outage. All signed-in users see all four service statuses regardless of individual grants. Signed-out pages and the sample preview do not fetch real status or notices.

An authenticated client fetches cached status initially and every 30 seconds while visible, refreshes on returning to the tab, and stops polling on unmount/sign-out. A failed refresh must mark retained results stale after the same freshness deadline; it must not leave a permanently green display.

## Automatic checks

Checks originate from the portal server and use deployment-configured destinations, never URLs supplied through the API or notice editor. Monitor the public service origins users launch where possible. Results describe reachability from the portal, not independent external monitoring.

| Service | Proposed check and what success means |
| --- | --- |
| Plex | GET the configured Plex server's `/identity`; parse the expected Plex response and match the configured server identifier. Confirms this media server responds, rather than merely Plex cloud sign-in. |
| Jellyfin | GET public Jellyfin `/health`; require its expected healthy response. Confirms the public route and service/database health. |
| Seerr | GET its status API under the configured public base URL; require the expected status JSON. Verify the deployed version's endpoint during implementation; a login page or generic HTTP 200 is never success. |
| Live TV | GET the public gateway `/health`, plus a new authenticated private gateway diagnostic checking configured viewer availability and the private proxy's channel lineup. Require a recognizable viewer page and valid nonempty M3U lineup. Confirms delivery components respond without opening a channel stream. |

The gateway diagnostic uses the existing internal shared key, constant-time credential comparison, fixed upstream/viewer destinations, bounded bodies, and timeouts. Responses contain component outcomes, not playlists, upstream bodies, URLs, tokens, or credentials. An unconfigured optional viewer is explicitly not applicable; the gateway's built-in landing-page mode remains supported. The public `/health` remains a simple liveness endpoint. Configure the portal's private gateway origin in Compose; direct diagnostic requests without the key fail. Deployment documentation must explain any reverse-proxy denial rule needed for the new internal diagnostic path.

No check tunes channels, transcodes, creates accounts, changes grants, sends mail, or modifies remote settings. An available result does not guarantee all titles, channels, codecs, or account integrations work.

Run one independent monitoring loop alongside existing background work, so slow mail or reconciliation cannot delay checks. Start a check promptly on boot and then once per minute. Check services concurrently with a single-flight guard per service; each service has a ten-second overall deadline including body reads. Reject redirects and bound response bodies. Repeated page reads never trigger probes.

Use these states:

- **Unknown:** never checked, invalid/missing check configuration, or last completed check older than three minutes.
- **Checking:** first failure after a healthy result, pending confirmation. Do not claim healthy while confirmation is pending.
- **Unavailable:** two consecutive failed probes separated by at least 60 seconds.
- **Responding:** a successful probe; a single successful probe recovers an outage.

Missing check configuration does not count as a service outage. After a stale gap or process restart, reset failure-confirmation counters so old failures do not combine with a new isolated failure. Track outage start as the first failure in the confirmed sequence. Manual "Check now" shares the single-flight guard and a global 15-second cooldown; repeated clicks within a minute cannot confirm an outage faster. Run pending checks without changing the last completed-check timestamp.

Persist the latest result, timestamps, failure count, and sanitized component diagnostics in SQLite. On boot treat saved measurements as unknown until checked again, while preserving manual notices. Keep the current outage's start/recovery information; a historical uptime dashboard is outside this version.

## Administration and notices

Add `/admin/status` linked from Admin. Show measured state, last check, last successful check, outage start, and safe diagnostic categories such as timeout, HTTP error, unexpected response, or configuration needed. Provide "Check now". Existing integration-configuration indicators remain separately labeled; mail configuration is not a fifth monitored service.

Provide a notice editor with affected services (one or more of the four), type (outage or maintenance), title (120 characters), and plain-text message (2,000 characters). Create/edit saves a draft; explicit Publish makes it visible immediately. Administrators can edit a published notice or resolve it. Resolution removes it from user-facing banners and retains it in admin history; drafts may be deleted. Maintenance may announce an upcoming window in its message, but scheduling and automatic expiration are outside scope. Notices do not alter automatic measurements or monitoring frequency.

Publishing, editing, resolving, or deleting requires an admin session, existing origin/CSRF protections, and recent authentication. Viewing diagnostics and "Check now" require admin access; the latter uses origin protections and rate limits but does not need fresh authentication because it changes no access or published content. Audit notice changes and manual checks. Validate service IDs and render notices as escaped plain text.

## Architecture and data

Follow the existing Nuxt/server-core/SQLite patterns. Add a status core module with injectable clock and probe client, runtime wiring, independent monitoring timer, shared sanitized response types, a polling composable, user-facing components, and the admin page. Add versioned migrations in `Store` for status rows and notices; do not create an unrelated migrations framework or add dependencies.

Expose authenticated `GET /api/status` for sanitized measurements and active notices. Expose admin-only status diagnostics and notice management under `/api/admin/status`. Enforce no-store responses and keep raw errors, response bodies, credentials, private destinations, and Plex identity out of user responses and logs. Store only bounded diagnostic categories/HTTP codes/component names, not remote error strings. Browser polling reads cached database state and never causes remote checks.

Notice records contain ID, affected services, type, title, message, lifecycle state, author, and created/updated/published/resolved timestamps. Status rows contain the latest measurement and confirmation metadata. A monitor-configuration change invalidates previous results; retain only a non-secret fingerprint, never credential material, to detect changed check targets. Restoring a backup clears measurements and counters and demotes published notices to drafts requiring review, so historical outages are not republished as current.

## Verification and delivery

Use controlled local HTTP fixtures and fake time for response validation, redirects, timeouts/body limits, component failures, confirmation spacing, recovery, restart/staleness, configuration changes, and single-flight behavior. Test notice lifecycle and automatic/manual interactions. Extend real HTTP tests for signed-out/user/admin boundaries, origin enforcement, fresh authentication, sanitized responses, and SSR rendering. Ensure integration tests isolate monitor configuration and never call real public services.

Run the relevant suites, typecheck, production build, and HTTP integration suite. Inspect desktop and mobile layouts, including multiline notices, several affected services, unknown state, failure, and recovery. Preserve concurrent work in guides, account, styles, and deployment notes. Local implementation, commit, and production deployment are separate states; this design does not assume deployment has occurred.

## Sources and builder discretion

Local owning sources inspected: `server/core/config.ts`, `server/core/db.ts`, `server/core/jobs.ts`, `server/utils/runtime.ts`, `server/plugins/jobs.ts`, `server/api/[...path].ts`, `server/core/restore.ts`, `app/app.vue`, `app/components/ServiceDashboard.vue`, `app/pages/admin/index.vue`, and `integrations/iptv/gateway.mjs`.

Endpoint references: [Plex developer documentation](https://developer.plex.tv/pms/) describes server identity; [Jellyfin monitoring documentation](https://jellyfin.org/docs/general/post-install/networking/advanced/monitoring/) describes `/health`. Implementation verified [Seerr's owning route](https://github.com/seerr-team/seerr/blob/develop/server/routes/index.ts): `/api/v1/status` returns version and commitTag; the empty `checkUpdateAvailable=` query value avoids a version-check side effect. The local viewer configuration confirms its stable `Live TV · Bulock Media` title for response validation. Deployed endpoints still need live validation at release time.

The builder may choose component boundaries, table/endpoint action names, exact spacing/copy, and bounded response-size limits. Preserve the agreed semantics above. If deployed endpoints differ, adapt the probe and document its scope without treating redirects or generic pages as healthy.
