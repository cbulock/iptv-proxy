replaceSourcesInternal() executes DELETE FROM sources and inserts new UUIDs, even for an unchanged provider payload. Foreign-key cascades delete source_channels, channel_bindings, guide_bindings, and sync history. The config PUT returns success without rebuilding those rows. A normal Save Sources can reset preferred streams and guide selections; until refresh, database-backed outputs and cached playback disagree.

Code: [libs/source-service.js#L69-L118](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/libs/source-service.js#L69-L118). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: An isolated execution of the actual service against the repository schema in an in-memory SQLite database changed source_channels from 1 row to 0 after saving loadProvidersConfigFromStore() unchanged.

Acceptance criteria:

- [ ] Upsert retained providers using stable IDs; delete only explicitly removed providers.
- [ ] Preserve discovered-channel IDs, preferred stream selections, guide selections, and history on no-op saves and EPG-URL edits.
- [ ] Round-trip provider identity and supported enabled settings through validation and compatibility exports.
- [ ] Add integration tests for unchanged saves, provider edits, and intentional deletion; keep affected MCP provider shapes and side effects aligned.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
