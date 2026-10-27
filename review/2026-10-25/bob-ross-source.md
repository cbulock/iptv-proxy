# Bob Ross source

## Direct-stream configuration (October 26, 2026)

The live provider now uses `https://jmp2.uk/plu-5f36d726234ce10007784f2a.m3u8` directly. The XMLTV URL remains unchanged. Channel name, TVG ID, logo, group and original base guide number are retained in the SQLite-backed channel mapping. The existing output-profile override of **800** is preserved, along with all other profile settings and the canonical ID. Compatibility playback remains verified.

The unused `/config/bob-ross.m3u` was archived under `/data/source-additions/2026-10-26T04-03-24-403Z-bob-ross-direct/`, together with an online database backup and original settings. A fresh channel reload passed with the playlist absent; guide binding, metadata and output entries matched their pre-change values. An eight-second audio/video sample decoded successfully through the compatibility endpoint after the file was removed.

## Original playlist configuration

Added to the live `iptv-proxy` container on `plex` on October 25, 2026 (America/New_York).

- Source: The Bob Ross Channel, `defdc4b0-bca0-4d52-b337-090834a3de48`.
- Persistent playlist: `/config/bob-ross.m3u` (local copy: `config/bob-ross.m3u`).
- Stream: `https://jmp2.uk/plu-5f36d726234ce10007784f2a.m3u8`, listed by `https://iptv-web.app/US/TheBobRossChannel.us/`.
- Guide: `https://raw.githubusercontent.com/matthuisman/i.mjh.nz/master/PlutoTV/us.xml`.
- Matching XMLTV ID: `5f36d726234ce10007784f2a`.
- Canonical ID: `7a086ffd-3d35-4b1d-b1ba-4b8cde92c67a`.
- Source channel ID: `289e2663-0844-4687-b335-0b9008cb7809`.
- Enabled in the default lineup on channel 201, group Arts, with channel logo.

The existing source service appended the provider, preserved the four existing providers and exported live `providers.yaml`. The repository's older `config/providers.yaml` was left unchanged. No application code or admin assets were changed or built.

Backup: `/data/source-additions/2026-10-26T03-41-57-769Z-bob-ross/` contains an online SQLite backup, original provider list, and original output entries. The container mounts `/opt/iptv-proxy/config` and `/opt/iptv-proxy/data` on the host.

Verified: source reload succeeded; EPG imported 33 programmes; the published web guide contained 28 current/upcoming Bob Ross programmes. The default lineup grew from 26 to 27 channels, preserving all previous enabled IDs. An eight-second sample decoded video and audio both directly from the upstream and through `/transcode/channel/289e2663-0844-4687-b335-0b9008cb7809`.

Playback limitation: use compatibility mode. Direct HLS playback is blocked by the existing proxy origin check when Pluto playlists reference segments/keys on `siloh-ns1.plutotv.net`, a different origin from its playlist server. No origin protections were weakened.

Live Brave verification: refreshed `https://iptv.bulock.house/`, found channel 201 and its programme schedule, and started playback. The default Auto setting automatically selected compatible playback and displayed the video successfully. Screenshot: `bob-ross-live.png`.

The MCP channel reload updates SQLite but omits invalidating the in-memory channel snapshot. A container restart loaded the new snapshot; health returned 200 afterward. A separate existing Weathervane upstream returned 404 during source refresh; its provider configuration and previously enabled channel membership were preserved.
