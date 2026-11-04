# Usage heartbeat release — 2026-10-26

IPTV Proxy's Usage tab dropped an active browser viewer after 45 seconds in
compatibility mode. The transcode route registered usage on its first output
chunk but never refreshed `lastSeen` while the connection remained open. The
active usage API pruned the entry after its 45-second idle limit.

The transcode route now calls `touchUsage` every 10 seconds after registration
and clears the timer when playback closes. `index.js` passes the existing
usage helper into the route. A focused integration test reproduced the missing
refresh before the fix and passed afterward. The usage and transcode integration
files passed together (12 tests); ESLint, Prettier, and `git diff --check`
passed on the changed files.

Production on Plex runs `bulock-iptv-proxy:usage-heartbeat-20261026`, layered
on `bulock-iptv-proxy:usage-identity-20261026` with only `index.js` and
`server/transcode.js` copied in. The isolated candidate passed health, exact
source hash, and 28-channel lineup checks before cutover. The live container
passed the same checks after cutover, and `/health` returned `status: ok`.
The prior container is stopped and retained as
`iptv-proxy-rollback-usage-heartbeat-20261026`. No portal, gateway, viewer,
configuration, or database migration was changed. The production restart
briefly disconnected active playback.

The release directory on Plex is `/opt/live-tv-releases/20261026-usage-heartbeat`.
