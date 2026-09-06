Output-profile channels expose streamName from the raw source-channel name, and lineup URLs use that name. getChannels() instead contains mapped names from parseAll(). The stream route searches that cache by source + name, so a mapping from Original to Renamed emits /stream/A/Original and returns 404. Transcode and stream-probe use the same name-based lookup.

Code: [server/lineup.js#L250-L266](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/lineup.js#L250-L266). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: An isolated execution of the lineup handlers emitted http://proxy.test/stream/A/Original for a mapped channel and returned 404 when resolving that emitted URL.

Acceptance criteria:

- [ ] Use stable source-channel IDs for route resolution, or preserve an unambiguous raw identity with backward-compatible URL lookup.
- [ ] Verify generated M3U/JSON URLs, preview, probe, and transcode all resolve after mapping renames and canonical custom names.
- [ ] Cover duplicate display names within a source, preferred-source changes, and old URL compatibility.
- [ ] Update MCP-returned channel/stream shapes and integration tests if the identity contract changes.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
