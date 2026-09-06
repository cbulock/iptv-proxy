rewriteImageUrls() caches XML by host/protocol/source/channels but omits the profile path. Fetching profile A then B returns A's cached XML for B. The filtering handler also skips filtering when the allowed set is empty, so an empty profile returns the full merged guide. Its channels query replaces profile membership instead of intersecting it, allowing profile A to emit B-only guide data. The unscoped default endpoint should also select its own profile from the union used for merging.

Code: [server/epg.js#L112-L122](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/epg.js#L112-L122). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Isolated execution of setupEPGRoutes with real XML parsing/cache and mocked sources reproduced identical A/B responses, both channels in an empty profile, and B emitted by profile A with channels=b.

Acceptance criteria:

- [ ] Include profile identity and every representation-affecting URL/filter value in cache keys.
- [ ] Apply an empty allowed set as an empty guide, and intersect source/channels filters with profile membership.
- [ ] Keep the default guide aligned with the default lineup even when other profiles are enabled.
- [ ] Add alternating-profile, empty-profile, unknown-source, combined-filter, and default-versus-named-profile route tests.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
