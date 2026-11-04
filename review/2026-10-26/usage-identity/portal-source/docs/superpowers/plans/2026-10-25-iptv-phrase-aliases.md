# IPTV Phrase Aliases Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Provide stable three-word personal playlist and guide URLs.

**Architecture:** Store phrase hashes and encrypted phrases alongside native grants. Resolve the two public aliases through an authenticated internal operation, then reuse native gateway protection and rewriting. Enforce the shared lookup budget in SQLite before resolution.

**Tech Stack:** Nuxt, Node crypto, SQLite, existing Vue controls.

**Spec:** ../specs/2026-10-25-iptv-phrase-aliases-design.md

## Global Constraints

- Three independently random lowercase words, separated by hyphens, from at least 4,096 distinct words.
- Shared 60-attempt/minute budget across successes and failures before lookup; persisted across restart.
- Preserve existing native URLs and viewer sessions when first showing aliases.
- Rotation/revocation/restoration invalidate old aliases; disabled accounts cannot resolve aliases.
- Preserve the pre-existing gateway launch changes and test. No deployment or live data changes.

## Review Focus

- Concurrent first issuance must preserve one phrase and the existing native token.
- Unknown and malformed phrases consume the same shared budget as valid phrases.
- GET/HEAD and throttled responses preserve status, no-store and Retry-After.
- Alias query strings or suffixes must not expose arbitrary upstream resources.
- Backup restore and admin reapproval cannot resurrect old aliases.

### Task 1: Phrase issuance, persistence and resolution

**Files:** server/core/iptv.ts, server/core/db.ts, server/core/restore.ts, new server/core/iptv-words.ts and tests/iptv-aliases.test.ts; word-list attribution in docs/iptv-phrase-wordlist.md.

**Interfaces:** Iptv.appCredentials(id): {token:string;phrase:string}; Iptv.resolveAlias(phrase): {allowed:boolean;token?:string;retryAfter?:number}.

- [x] Write failing tests for stable issuance/persistence, migration preservation, collision retry, lifecycle invalidation and shared budget/reset/restart.
- [x] Run node --experimental-strip-types --test tests/iptv-aliases.test.ts; confirm missing-feature failures.
- [x] Add migration 9 with unique nullable phrase_hash and phrase_cipher; obtain and document EFF word-list provenance, filter for short suitable words, and verify >=4,096 unique entries. Use crypto.randomInt.
- [x] Add transactional issuance, collision retry, lifecycle clearing, and shared pre-lookup counter. Return a structured denial with remaining Retry-After when over budget, rather than throwing inside the counter transaction.
- [x] Run the new tests plus activation/recovery tests; expect all pass.

### Task 2: Protected public aliases and API

**Files:** integrations/iptv/gateway.mjs, server/api/[...path].ts, tests/gateway-aliases.test.ts, tests/integration/iptv-session.test.ts.

**Consumes:** Task 1 interfaces.

- [x] Write gateway HTTP tests using real local portal/upstream servers for playlist/guide, HEAD, errors, queries, suffixes, revocation, token rewriting, and throttling; update HTTP API expectations for phrase URLs and protected internal resolution.
- [x] Run gateway tests before implementation; expect alias HTTP failures.
- [x] Add authenticated internal/iptv/alias; return playlist/guide alias URLs from existing credential endpoint, rotating native credentials first when requested. Add no-store to credential responses.
- [x] Resolve /p/<phrase> and /g/<phrase> before normal auth, preserve native check/revalidation and resource binding, propagate 429 with Retry-After, deny malformed aliases, and reject alias queries.
- [x] Run gateway and API integration verification against a fresh production build; expect all pass.

### Task 3: User instructions and final checks

**Files:** app/pages/account.vue, app/components/LiveTvGuide.vue, final verification record in this plan.

- [x] Add concise phrase guidance and explain changing /p/ to /g/, using existing copy controls.
- [x] Run full core suite, type checks, production build and HTTP integration suite. Review diff and ensure the launch fix remains intact.
- [x] Review the complete change for security/lifecycle regressions and resolve findings before reporting completion.

## Execution ledger

- User approved design and implementation. Execute inline in the current feature checkout to preserve the pending gateway change; no new worktree or further plan approval needed under the session's authorization instructions.
- Baseline core suite attempted in sandbox: local HTTP tests cannot bind/listen; rerun with appropriate execution permissions. Existing dependencies are installed.

- Task 1 complete: migration, encrypted/stable issuance, collision retry, lifecycle clearing and persisted limiter verified; concurrent first issuance is atomic across processes. Ruling: first native issuance happens inside the alias transaction without invoking rotation, preserving pre-existing browser sessions.
- Task 2 complete: direct gateway aliases and authenticated internal resolution verified, including HEAD, malformed/query paths, replacement/revocation, native playback rewriting and 429/Retry-After. Updated both existing HTTP integration expectations for the new URL format.
- Task 3 complete: account/setup instructions updated. Final verification: 113 core tests passed; all 3 HTTP integration tests passed; Nuxt prepare plus scripts/verify-types.mjs passed; production build passed; git diff --check passed.
- Independent review found no critical or important issues. Its minor startup-readiness concern in the concurrent test was corrected with error/close rejection and a test timeout. Reviewer also independently checked six concurrent issuers and the shared 60-of-120 lookup limit.
- Implementation remains local and uncommitted on codex/plex-setup; no deployment or production data changes. The pre-existing gateway launch modification and tests/gateway-launch.test.ts remain intact.
