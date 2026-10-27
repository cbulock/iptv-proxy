# Deinterlacing release

Deployed 2026-10-25 (America/New_York) at the user's request.

Host: `plex`. Container: `iptv-proxy`. Image:
`bulock-iptv-proxy:deinterlace-20261025`
(`sha256:cddd51fb52dab190222dbfeea01dda8e29522ebea79e302817058d2aaed86b46`).

This image extends the verified `channels-20261025` production image and replaces
only `server/transcode.js` and `server/mcp.js`. No admin build was run. The local
implementation and tests remain uncommitted.

The transcoder now applies
`bwdif=mode=send_field:parity=auto:deint=interlaced` before H.264 encoding.
The published-channel MCP tool description documents this behavior.

Validation:

- 33 targeted transcoder, worker-lifecycle, and MCP checks passed before deployment.
- Candidate used copied config and an integrity-checked SQLite online backup.
- Candidate FFmpeg successfully encoded 60 output frames from generated interlaced
  video using the deployed BWDIF options and libx264.
- Candidate and live source hashes match the uploaded files.
- Candidate and live health, channel membership (26 IDs), guide pagination
  (1,113 programmes, including 61 for The Ocho), and unchanged admin asset hash passed.
- Live picture quality remains for the user's live-TV test.

Release directory: `/opt/live-tv-releases/20261025-deinterlace`.
Deployment script: `deploy-deinterlace.py`; image recipe: `Dockerfile.deinterlace`.
The script creates another integrity-checked online database backup immediately
before promotion and automatically restores the previous container on failed
live verification.

Rollback container: `iptv-proxy-rollback-deinterlace-20261025`.
Previous image: `bulock-iptv-proxy:channels-20261025`.
Backup: `before-promotion.sqlite` in the private release directory.
For an application rollback, stop and rename the new container, rename the retained
rollback container to `iptv-proxy`, and start it with its existing mounts. Do not
restore the database merely to roll back the application image.
