# Security policy

CI treats ESLint, Prettier, and `npm audit --audit-level=moderate` failures as
blocking for both the server and admin dependency trees. There are currently no
audit exceptions.

Pull requests build a single-platform image and load it into the CI runner.
Trivy scans that exact local image tag and fails the workflow for unfixed
`HIGH` or `CRITICAL` findings. Its build digest and scanned tag are recorded in
the job summary.

## Exceptions and suppressions

Do not add `continue-on-error` to security or quality checks. A temporary audit
or Trivy exception requires a tracked issue, a concise risk rationale, an owner,
and an expiry date. Record it in this file and remove it when the upstream fix
is available. There are no active Trivy suppressions (`.trivyignore`) in this
repository.
