EPG ingestion reads entire local files or downloads full responses, then builds a complete parsed object and merged XML string. HTTP downloads have no response-size bound here. getGuideData(), filtering, display-name rewriting, and image rewriting repeatedly parse the full guide. CacheManager has no capacity limit and only lazily removes expired entries. This conflicts with the repository's bounded-memory XMLTV requirement.

Code: [server/epg.js#L379-L411](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/epg.js#L379-L411). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static review; no large-feed benchmark was run. Repeated full-document representations and unbounded cache cardinality are visible in server/epg.js and libs/cache-manager.js.

Acceptance criteria:

- [ ] Stream local/HTTP XMLTV input with gzip handling and bounded parser/backpressure behavior.
- [ ] Index programmes for guide queries instead of reparsing the full XML on every request.
- [ ] Bound cache bytes/entries and reclaim expired entries without requiring the same key to be read again.
- [ ] Add representative large-feed memory/latency checks and compressed-input regressions; preserve canonical XMLTV IDs and LAN sources.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
