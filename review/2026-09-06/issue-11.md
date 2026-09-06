A fetch failure is caught per source, but the merger still assigns a new XML document from successful inputs. If every source fails, a previously valid guide becomes empty and refreshEPG resolves successfully. Partial failures drop the failed source's guide. Refreshes can also overlap through the module interval, scheduler, config/API and MCP mutations, allowing an older request to overwrite newer guide selections.

Code: [server/epg.js#L559-L586](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/epg.js#L559-L586). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: An isolated production merge-loop probe loaded two guides, made both source fetches fail, refreshed, and observed zero programmes in the served XML.

Acceptance criteria:

- [ ] Retain last-known-good guide data per source during transient failures and expose stale/error state.
- [ ] Return/report a meaningful failed or degraded refresh outcome through HTTP, scheduler, and MCP envelopes.
- [ ] Use one coordinated refresh pipeline, prevent stale results from overwriting newer configuration, and remove duplicate scheduling.
- [ ] Test all-source failure, partial failure, recovery, and overlapping refreshes with out-of-order completion.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
