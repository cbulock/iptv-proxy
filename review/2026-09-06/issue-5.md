loadPublishedChannels() treats an empty default output as a missing model and falls back to mapped source channels. Disabling every entry therefore republishes mapped channels through /lineup.json and /lineup.m3u, while /profiles/default/... is empty. Removing all guide numbers can trigger the same fallback.

Code: [server/lineup.js#L163-L180](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/lineup.js#L163-L180). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: The isolated lineup probe returned one mapped channel with getOutputProfileChannels() returning an empty array.

Acceptance criteria:

- [ ] Distinguish an intentionally empty profile from an uninitialized legacy model.
- [ ] Make default aliases and /profiles/default endpoints emit the same membership, including zero channels.
- [ ] Keep include_unmapped as an explicit opt-in only.
- [ ] Add end-to-end disable-all and remove-all-guide-numbers regressions, including MCP updates followed by public lineup reads.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
