index.js sets trust proxy=true for all peers. Auth setup authorizes LAN clients using req.ip, and several rate limiters skip loopback IPs. A direct client can supply X-Forwarded-For: 127.0.0.1 and be treated as loopback, bypassing those intended checks. Generated URL helpers also read forwarded headers independently of a trusted-proxy policy.

Code: [index.js#L54](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/index.js#L54). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: A local Express request-object probe with socket address 203.0.113.12 and the forwarded header resolved req.ip to 127.0.0.1; no remote exploit request was sent.

Acceptance criteria:

- [ ] Default to direct-peer identity and provide explicit proxy trust configuration for known proxy hops/networks.
- [ ] Use the same trust policy for IP authorization, rate limiting, protocol, and generated host values.
- [ ] Test forged forwarded headers from untrusted peers plus legitimate reverse-proxy traffic.
- [ ] Retain LAN/private upstream support; this fix concerns inbound proxy trust, not blocking local sources.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
