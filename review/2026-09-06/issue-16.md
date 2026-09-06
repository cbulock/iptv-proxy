Save Output Profile sends sequential requests for each changed custom name, preferred stream, and guide binding, followed by profile entries. Each server mutation awaits refreshEPG(), which downloads all guide sources. Editing many rows makes one Save perform repeated full-feed downloads and merges; a slow feed makes the UI wait through every round.

Code: [admin/src/App.vue#L2419-L2635](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/admin/src/App.vue#L2419-L2635). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static trace from saveOutputProfileChanges() to canonical route mutation handlers and refreshEPG(). No browser timing benchmark was run.

Acceptance criteria:

- [ ] Introduce a batch mutation or a coordinated refresh mechanism that applies one user save with at most one guide refresh.
- [ ] Rebuild from cached source data for label/profile-only edits when source downloads are unnecessary.
- [ ] Define partial-failure/atomicity semantics and preserve unsaved drafts with accurate row feedback.
- [ ] Expose equivalent batch behavior through MCP with the stable result envelope and side effects; add request/download-count tests for multi-row saves.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
