> Historical implementation ledger. See [deployment status](deployment-status.md) for current deployment and repository layout.

# Implementation ledger

Plan: docs/superpowers/plans/2026-10-23-bulock-media.md

Ruling: Build in the empty supplied directory; it is not a Git repository, so there is no branch/worktree to isolate.
Ruling: Use Node 24 built-in SQLite to avoid a native dependency and keep deployment single-instance.
Ruling: Execute the supplied approved plan directly; no further plan approval is needed.
Pre-flight: auth produces session/user IDs; services consume IDs and grants; HTTP validates all boundaries; UI consumes sanitized API models. IPTV adapter uses a separately authenticated internal API.

Tasks 1–4 implemented: auth, persisted data, service adapters, HTTP boundary, responsive UI/admin/guides. Initial tests and production build pass; review fixes and full verification underway.
Task 5 implemented as gateway extension with optional legacy-player overlay. Ruling: live iptv.bulock.house is an IPTV Proxy landing page, not the local iptv-web player; default launch preserves setup/download behavior with protected access, optional viewer is opt-in at deployment.
Task 6 operations files, restore invalidation, and acceptance guide implemented.
Review fixes: preserve desired library policy during remote awaits, converge on latest policy, protect job generations, require explicit Jellyfin regrant after disable, forward SSR cookies in admin, require fresh auth for admin mutations.
Ruling: IPTV gateway supports the inspected proxy's protected /stream/source/name?upstream=... manifest format; it is not a generic arbitrary-upstream relay. This avoids exposing arbitrary routes. Production playlist shape remains an acceptance check.
No live service configuration, account changes, emails, commits, or publication performed.

Final local verification: 25 core/security tests, one production HTTP integration test, TypeScript checks, and production build pass. Desktop/phone preview inspected. Strict plain-address email validation and sanitized library catalogs prevent recipient-list parsing and upstream-token exposure. Nodemailer updated; production audit zero, full audit seven build-toolchain advisories documented in README. Docker engine unavailable, so container execution and live integration/pilot gates remain outstanding.
