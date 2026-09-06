setupHDHRRoutes() builds BaseURL and LineupURL from config.host with a hard-coded port 34400. index.js forces host to localhost. A client on another LAN machine receives URLs pointing at itself; PORT and reverse-proxy configuration are ignored.

Code: [server/hdhr.js#L1-L15](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/server/hdhr.js#L1-L15). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Calling the actual discover handler with a LAN Host header returned BaseURL=http://localhost:34400.

Acceptance criteria:

- [ ] Resolve the advertised URL from configured public/base URL or the validated request origin.
- [ ] Honor custom ports and supported reverse-proxy deployments.
- [ ] Test direct LAN requests, custom PORT, configured base URL, and proxy headers.
- [ ] Preserve private IP and local hostname support.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
