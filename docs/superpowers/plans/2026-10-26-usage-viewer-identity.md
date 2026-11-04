# Usage Viewer Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show authenticated account names in IPTV Proxy usage while preserving anonymous use.

**Architecture:** Portal check returns user ID and name; gateway forwards them with an opt-in shared secret; proxy validates and records identity for usage; admin shows it. The stream authorization path remains in the gateway.

**Tech Stack:** Node.js ESM, Express, Vue 3, Mocha/Chai, node:test.

**Spec:** `docs/superpowers/specs/2026-10-26-usage-viewer-identity-design.md`

## Global Constraints

- Preserve unrelated working-tree changes in both repositories.
- Do not run the admin build.
- Keep direct, anonymous IPTV Proxy use working.
- Add focused tests before behavior changes.

## Review Focus

- Spoofed identity headers without a correct secret must remain anonymous.
- Two users at one proxy IP on one channel must have separate rows.
- Non-ASCII names must survive the gateway-to-proxy hop.
- Disallowed portal tokens must disclose no identity.
- Gateway test hooks returning a boolean must remain compatible.

---

### Task 1: Proxy usage identity

**Files:** `server/usage.js`, `server/lineup.js`, `server/transcode.js`, `index.js`, `test/integration/usage.test.js`, `test/integration/transcode.test.js`.

**Interfaces:** `readUsageIdentity(req, secret)` returns `{userId, userName}` or `null`; `registerUsage` accepts those optional fields.

- [x] Add tests for valid and invalid identity headers, non-ASCII names, and same-IP distinct users.
- [x] Run targeted tests and observe the expected failures.
- [x] Implement trusted identity extraction and usage keying.
- [x] Record active transcoded playback through the same usage helpers.
- [x] Run targeted tests and verify passing output.

### Task 2: Portal and gateway identity forwarding

**Files:** `media-user-center/server/core/iptv.ts`, `media-user-center/integrations/iptv/gateway.mjs`, portal and gateway tests.

**Interfaces:** Portal `verify` adds `userName` to an allowed result; gateway forwards percent-encoded ID and name with the configured shared secret.

- [x] Add portal and gateway tests for account names, header stripping, and optional configuration.
- [x] Run targeted tests and observe the expected failures.
- [x] Implement portal response and gateway headers.
- [x] Run targeted tests and verify passing output.

### Task 3: Usage display and documentation

**Files:** `admin/src/App.vue`, `README.md`, `config/examples/app.example.yaml` only if config changes.

- [x] Add Usage table name and ID columns, with anonymous rows still readable.
- [x] Document both-service secret and header contract.
- [x] Run relevant tests and static checks in both repositories; inspect final diffs.
