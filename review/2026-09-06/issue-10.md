The merger appends channel/programme arrays without deduplicating programmes by (channel,start,title) or resolving duplicate source records deterministically. bindingRuleByInputId also stores just one rule per input channel ID, dropping earlier rules when multiple canonical channels intentionally select the same source guide channel.

Code: [server/epg.js#L350-L483](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/epg.js#L350-L483). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static review of the merge loop. test/integration/epg.test.js mainly tests synthetic array concatenation rather than production conflict/fan-out behavior. The earlier broad EPG issue #16 is closed, so this tracks the remaining concrete semantics.

Acceptance criteria:

- [ ] Deduplicate channels and programmes with documented deterministic priority rules.
- [ ] Represent input-guide-channel selection as one-to-many and emit each requested canonical output ID.
- [ ] Preserve language-tagged titles and canonical IDs during deduplication and rewriting.
- [ ] Test duplicate records, conflicting sources, and two canonical channels bound to one source guide ID through actual XMLTV routes.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
