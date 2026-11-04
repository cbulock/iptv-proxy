# Plex access and device guides

Portal invitations authorize self-service Plex access for newly admitted email users. A viewer creates a free Plex account if needed, connects it through Plex sign-in, then enables access. Portal and Plex email addresses may differ: sharing targets the authenticated Plex ID.

## Administrator setup

In Admin, load **Default Plex libraries**, select the libraries to share, and save. These are Plex's cloud sharing IDs, not local library keys or Jellyfin mappings. The selection starts empty; no automatic invitation is possible until configured. Existing shares and pending invitation snapshots are never expanded by changing defaults.

Plex setup and open help requests appear in Admin. Help email uses the active administrator's verified portal email. Missing email/SMTP configuration leaves a visible request and notification warning. **Review invitation** explicitly authorizes recovery after checking Plex; it cannot run for a disabled person. Resolving a help request does not grant access.

Migration 4 adds settings, provisioning history, a cross-process invitation lease, and help records. Migration 5 adds saved Plex authentication return destinations and tolerates databases upgraded during development. Existing users have unknown eligibility and need review if Plex reports no share. Previously confirmed access is recorded permanently; removing it in Plex never permits self-service restoration. Disabling a portal account does not revoke existing Plex shares.

## API and UI

- `/api/me` includes `plexSetup`: state, checked timestamp, safe error message, selected library IDs, open help information, and allowed actions.
- Authenticated POST endpoints: `/api/plex/check`, `/api/plex/enable`, `/api/plex/help`. They use the session identity, origin protection, and rate limits.
- Administrator endpoints: GET `/api/admin/plex`, GET `/api/admin/plex/libraries`; POST `/api/admin/plex/defaults`, `/retry`, `/check`, `/resolve`. Writes require recent authentication.
- `/guides?service=plex&device=roku` is bookmarkable. Missing/invalid platform values show the chooser. Login, Plex callback, and email verification preserve validated internal return paths.
- Only browser playback shows the configured Plex server address. Other paths show official player app/store links and TV linking instructions where relevant. Account and guides share one setup component.
- Roku has on-device sign-in instructions rather than a TV link-code action. Other TV paths explain QR/code linking. Its current store listing replaces the obsolete numeric listing linked by Plex's device page.

After any uncertain remote write, check Plex before retrying. Automatic retries never repeat an attempted invitation. Pending shares are not ready until Plex's server-specific user entry confirms acceptance and at least one library.

## Validation and release

Local checks cover authorization, identity linkage, duplicate submissions, interrupted invitations, lost leases, library selection, removed access, notification deduplication, guide routing, and rendered HTTP behavior. Run `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:integration`.

Read-only live checks on 2026-10-23 verified the server catalog, share fields, and server-specific acceptance flags. No live invitation was sent: the designated test email did not yet have a Plex account. The administrator explicitly waived the live invitation-and-acceptance pilot for this release. Real invitation delivery and acceptance remain unverified.

Optional explicit live-test helpers:

1. `node scripts/plex-test-signin.mjs start EMAIL` creates a sign-in link; the test-account owner completes it. Run with `finish` to verify identity. Credentials are not persisted.
2. `node scripts/test-plex-invitation.mjs EMAIL --send` sends only Movies and TV Shows using an isolated journal. Existing access remains unchanged. Without `--send`, it checks state only. It never updates the production portal database or sends portal notification mail.
3. Accept the invitation in Plex, then run the check again and confirm `ready`. The account must be distinct from the server owner. Do not remove existing access to make a test pass.

The local browser fixture is `node scripts/preview-plex-guide.mjs`; it uses a synthetic account and no production integration credentials.

Sources checked: [PlexAPI sharing implementation](https://python-plexapi.readthedocs.io/en/latest/_modules/plexapi/myplex.html), [official player apps](https://www.plex.tv/apps-devices/), [TV linking](https://support.plex.tv/articles/203395277-connect-app-to-your-plex-account/), [supported smart TVs](https://support.plex.tv/articles/204080173-which-smart-tv-models-are-supported/), and [remote playback requirements](https://support.plex.tv/articles/requirements-for-remote-playback-of-personal-media/).
