HDHomeRun discover.json and lineup.json fetches have no timeout. parseAll waits for every source, and index.js awaits parseAll before app.listen. A tuner accepting a connection but never responding can prevent the entire admin/health server from starting. The source TVG-ID discovery path in server/config.js repeats the unbounded fetches.

Code: [scripts/parseM3U.js#L106-L109](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/scripts/parseM3U.js#L106-L109). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static trace through processSource, parseAll, and index.js initialization. No real tuner was contacted.

Acceptance criteria:

- [ ] Apply bounded discovery/lineup deadlines and cancellation using a shared source fetch policy.
- [ ] Bring up admin/health endpoints with persisted channel state while slow refresh work runs, or otherwise guarantee a bounded startup.
- [ ] Report per-source failure without preventing healthy sources or cached channels from serving.
- [ ] Add never-responding discovery/lineup mocks and a startup readiness test; keep local IPs/hostnames supported.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
