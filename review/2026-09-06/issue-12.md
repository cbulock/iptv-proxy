Canonical identity is derived from tvg_id + guideNumber + name. Changing a mapping display name or guide number changes the identity, allocates a new UUID, and drops custom names and prior stream/guide choices. Output entries are restored by the same old identity, so their user settings are lost too.

Code: [libs/canonical-channel-service.js#L109-L218](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/libs/canonical-channel-service.js#L109-L218). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Executing the actual rebuild function against an in-memory database, then changing a mapping name, produced a new canonical ID and reset custom_name to null.

Acceptance criteria:

- [ ] Anchor canonical identity to a stable persisted relationship independent of editable labels and guide numbers.
- [ ] Migrate/reconcile existing records while preserving profile positions/enabled state/overrides, custom names, preferred streams, and guide bindings.
- [ ] Define explicit merge/split behavior when mappings converge or diverge.
- [ ] Add repeated rename/renumber and reload regressions; preserve stable IDs exposed through MCP and HTTP.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
