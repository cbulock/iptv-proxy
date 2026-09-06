After restoring SQLite, the route calls replaceProvidersConfig(loadProvidersConfigFromStore()). That replacement deletes all sources and cascades away the discovered channels and bindings just restored. Restore also deletes live files before validating/copying the replacement and does not refresh channel/lineup/EPG caches. Backup creation closes the shared database then yields across asynchronous copies; another request can reopen/write it during the snapshot.

Code: [server/backup.js#L132-L205](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/backup.js#L132-L205). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static trace through restore and the source-service cascade, whose deletion behavior was reproduced separately. No production backup was restored during review.

Acceptance criteria:

- [ ] Export YAML from restored rows without mutating their identities or relationships.
- [ ] Use a consistent SQLite backup operation and unique snapshot names; serialize restore with other database writes.
- [ ] Validate/stage the backup before replacing live state, with rollback and database reopening on failure.
- [ ] Refresh dependent caches after restore so playback and API reads agree immediately.
- [ ] Add round-trip tests including preferred streams, guide bindings, output entries, concurrent reads/writes, and injected copy failures; document MCP exposure/side effects if added.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
