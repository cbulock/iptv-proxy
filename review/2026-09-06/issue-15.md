authenticateAccessToken() checks the token row, expiry, revocation and scope but does not verify that its client still exists in current configuration. Removing a client while another remains keeps OAuth enabled, so the removed client's previously issued tokens continue to authorize MCP operations until expiry.

Code: [libs/oauth-service.js#L293-L332](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/libs/oauth-service.js#L293-L332). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static trace through authenticateAccessToken() and requireMcpBearerAuth(); token validation never resolves getOAuthClient(row.client_id).

Acceptance criteria:

- [ ] Reject tokens whose client is removed or no longer permitted the required scope.
- [ ] Invalidate outstanding authorization codes as well as existing access tokens when a client is removed/disabled.
- [ ] Define and test credential-change/session/token revocation behavior so access removal is predictable.
- [ ] Test with two clients: remove one, reject its old token/code, and keep the other client's MCP access working.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
