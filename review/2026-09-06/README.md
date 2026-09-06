# Codebase review — 2026-09-06

Created 17 GitHub issues: 11 P1 and 6 P2. P1 means high-priority correctness, data preservation, access control, or availability work; P2 means the next reliability/performance work. Each issue includes source evidence and acceptance criteria.

Reviewed the local checkout at `5ee81345ba28f78676d2a725ad0f9552d624fd7d` and compared it with GitHub main at `0d923cf1d3f9cc7539017933c6aaa1d00a70d566`. The application files cited in these findings are unchanged between those revisions. Main has newer dependencies and a Docker healthcheck fix. There were no open issues before this review; existing Dependabot PRs were inspected and not duplicated.

## Recommended sequence

1. Preserve source identity and repair backup/restore (#164–165). Source deletion is also the immediate cause of restore losing relationships.
2. Correct profile membership, guide caching, stream resolution and discovery (#166–169).
3. Fix inbound proxy trust, upstream cleanup, and OAuth client removal (#170–171, #178).
4. Coordinate guide refreshes and bound tuner discovery (#174, #176).
5. Preserve canonical identity, improve guide ingestion/merge, bound transcoding, batch UI saves, and enforce CI checks (#172–173, #175, #177, #179–180).

## Issue backlog

| Issue | Priority | Work |
| --- | --- | --- |
| [#164](https://github.com/cbulock/iptv-proxy/issues/164) | P1 | Preserve source IDs and bindings when saving provider configuration |
| [#165](https://github.com/cbulock/iptv-proxy/issues/165) | P1 | Restore backups without deleting restored bindings or leaving partial live state |
| [#166](https://github.com/cbulock/iptv-proxy/issues/166) | P1 | Isolate XMLTV responses by output profile and intersect guide filters |
| [#167](https://github.com/cbulock/iptv-proxy/issues/167) | P1 | Resolve playback by stable source-channel identity after channel mapping |
| [#168](https://github.com/cbulock/iptv-proxy/issues/168) | P1 | Keep the default lineup empty when all profile entries are disabled |
| [#169](https://github.com/cbulock/iptv-proxy/issues/169) | P1 | Advertise a reachable LAN address in HDHomeRun discovery |
| [#170](https://github.com/cbulock/iptv-proxy/issues/170) | P1 | Make proxy trust explicit before using forwarded IPs for access checks |
| [#171](https://github.com/cbulock/iptv-proxy/issues/171) | P1 | Close upstream streams when viewers disconnect and health probes finish |
| [#172](https://github.com/cbulock/iptv-proxy/issues/172) | P2 | Stream XMLTV ingestion and bound guide/cache memory |
| [#173](https://github.com/cbulock/iptv-proxy/issues/173) | P2 | Enforce deterministic XMLTV deduplication and guide-binding fan-out |
| [#174](https://github.com/cbulock/iptv-proxy/issues/174) | P1 | Preserve the last good guide and coordinate concurrent EPG refreshes |
| [#175](https://github.com/cbulock/iptv-proxy/issues/175) | P2 | Preserve canonical IDs and user settings across mapping edits |
| [#176](https://github.com/cbulock/iptv-proxy/issues/176) | P1 | Bound HDHomeRun discovery and keep startup usable when a tuner stalls |
| [#177](https://github.com/cbulock/iptv-proxy/issues/177) | P2 | Bound ffmpeg resources and launch Windows transcoding without a command shell |
| [#178](https://github.com/cbulock/iptv-proxy/issues/178) | P1 | Invalidate OAuth access when its configured client is removed |
| [#179](https://github.com/cbulock/iptv-proxy/issues/179) | P2 | Save channel edits without downloading every EPG once per edited field |
| [#180](https://github.com/cbulock/iptv-proxy/issues/180) | P2 | Make CI scan the PR image it actually builds and enforce actionable checks |

## Review scope

The review covered source configuration/seeding and compatibility exports; SQLite schema and cascades; source discovery and snapshots; mapping/canonical identity; output profiles and M3U/JSON generation; XMLTV ingestion/filtering/guide queries; stream/HLS/probe/transcode code; authentication, CSRF, OAuth and MCP; backup/restore, health, usage, scheduler and cache services; Vue admin state, save and playback workflows; tests, configuration examples, documentation, Docker and CI.

This was a static code review with targeted isolated execution, not a complete live deployment/browser audit. No real tuner/provider was contacted, no real ffmpeg process was launched, and no production backup was restored. No admin build was run. Existing user edits were left intact.

## Validation and limits

- Existing non-integration suite: 175 passing, 13 failing.
- Existing integration suite retried serially: 44 passing, 78 failing. The configured parallel invocation could not spawn workers (`EPERM`).
- The available runtime is Node 24.19.0 ARM64; the installed `better-sqlite3` native binary fails to load as a valid Win32 application. Database-dependent tests therefore cannot establish a green baseline in this environment. The reported failures are not being filed as 91 independent product bugs.
- Existing ESLint invocation completed with exit 0 before adding these review artifacts.
- Fixture format validation completed successfully.
- [Isolated reproduction script](reproduce.mjs) completed successfully and confirmed ten faulty behaviors. It evaluates actual repository functions with mocked I/O/services; database probes use the repository SQL schema with Node's built-in in-memory SQLite. This does not substitute for the production driver's integration tests.
- The probes confirm: canonical identity/custom-name loss after a mapping edit; source-channel deletion after a no-op provider save; cross-profile XMLTV cache collision; a full guide for an empty profile; profile-membership bypass through a guide query; loss of the last good guide on source failure; localhost discovery URLs; spoofed forwarded IP acceptance; mapped-channel playback 404; and default empty-lineup fallback.
- Full test logs and exact issue bodies are retained in this directory.

No application implementation was changed. Follow-up work should add regressions around the actual service/route boundaries, particularly database cascades, consecutive profile requests, and streaming connection lifetimes, rather than relying solely on synthetic transform examples.
