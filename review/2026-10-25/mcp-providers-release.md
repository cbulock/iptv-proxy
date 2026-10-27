# MCP provider management release

Deployed October 25, 2026 (America/New_York) to `plex`, container `iptv-proxy`.

Image: `bulock-iptv-proxy:mcp-providers-20261025`, SHA256 `43266dc2f02c1f425fcdd42a9ab3a6d6b44643140203b74790f37679e61b49bc`.

Added `create_provider` and `update_provider`. They save a single provider through the existing SQLite-backed source service, preserve other sources, support M3U/direct HLS/HDHomeRun with optional XMLTV EPG, and return provider metadata without upstream URLs. Updates use stable IDs and preserve omitted fields. Invalid URL schemes, duplicate names, missing IDs and empty updates are rejected. Channel and guide refreshes remain explicit follow-up tools.

`reload_channels` now invalidates the in-memory channel snapshot and associated lineup caches, so newly added streams work without a restart. Workflow guidance and README document both tools and direct-stream guide binding.

Validation:

- 29 MCP integration tests pass, including source preservation, LAN/HTTPS/file URLs, updating a disabled source, credential omission, and channel-cache refresh. The cache test was observed failing with the old reload implementation.
- 215 non-integration tests pass.
- Full integration run before the final extra coverage: 221 pass, 3 fail. The exact same three failures reproduce on an isolated archive of HEAD: canonical route inferred-binding expectation, canonical route exact-object expectation after rename, and OAuth localhost/127.0.0.1 discovery expectation. Baseline evidence: `mcp-baseline-tests.log`.
- ESLint passes for the changed JavaScript files; `git diff --check` passes.
- Independent review found no blocking defects. Follow-ups for guide-removal reload guidance and provider rename documentation were addressed.
- Candidate used copied configuration and an integrity-checked online SQLite backup. An isolated MCP HTTP smoke test inside the candidate listed 27 tools and successfully created/updated a disposable source without modifying live configuration.
- Candidate and live checks passed: health 200, the same 27 enabled channel IDs, guide pagination with 1,120 programmes including 61 The Ocho programmes, and unchanged admin JavaScript asset hash.
- Live MCP `get_agent_workflow` confirms both provider tools and the updated channel reload side effects. The deployed MCP module SHA256 matches local source: `39703a994d4d76b53d9f56be866f9617124033f39a09dae64d9f9bfa8e38247f`.

Only `server/mcp.js` was replaced in the image, extending the existing deinterlacing image. No admin build was run. Existing source configuration, Bob Ross source, admin assets and transcoder were retained. Existing Weathervane upstream availability problems remain separate.

Release files: `/opt/live-tv-releases/20261025-mcp-providers/`. Promotion backup: `before-promotion.sqlite` within that directory. Retained rollback container: `iptv-proxy-rollback-mcp-providers-20261025`. Candidate container was stopped after successful promotion.

Local source/test/documentation changes remain uncommitted. MCP clients may need to refresh their tool discovery to see the new tools.
