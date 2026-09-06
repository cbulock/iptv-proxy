The PR Docker build uses push:false and does not load/export the image into the local daemon, but Trivy scans a registry image tag afterward. That scan cannot reliably inspect the just-built PR image. Trivy/upload failures and lint/format/audit checks all use continue-on-error, so a green workflow does not establish that these checks ran successfully.

Code: [.github/workflows/ci.yml#L160-L196](https://github.com/cbulock/iptv-proxy/blob/0d923cf1d3f9cc7539017933c6aaa1d00a70d566/.github/workflows/ci.yml#L160-L196). Reviewed 2026-09-06; these source files are unchanged between local 5ee8134 and GitHub main 0d923cf.

Evidence: Static workflow review. Open dependency-update PRs already exist and are not duplicated by this issue.

Acceptance criteria:

- [ ] Load/export a scanable PR image or scan its produced archive and tie the result to the built digest.
- [ ] Fail on scanner execution errors and missing reports; set an explicit policy for findings and suppressions.
- [ ] Make lint/format checks enforceable after resolving any baseline, and document deliberate audit exceptions.
- [ ] Verify the workflow on a PR with a known failing check and confirm the image scanned matches the build.

Validation note: the local full test suite could not pass because the installed better-sqlite3 binary is incompatible with the available ARM64 Node runtime. Reproductions mentioned above use isolated dependencies and do not claim full application integration coverage.
