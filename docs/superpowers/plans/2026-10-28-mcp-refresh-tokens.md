# MCP Refresh Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep authorized MCP clients connected through a renewable 30 day OAuth grant.

**Architecture:** Continue issuing short lived access tokens. Issue an opaque refresh token during code exchange, store only its hash in SQLite, and rotate it atomically on each refresh. Reject expired, reused, revoked, or client-ineligible refresh tokens. The 30 day expiry advances on successful refresh.

**Tech Stack:** Node.js ESM, Express, SQLite, Mocha/Chai/Axios.

**Spec:** User request in this chat: keep OAuth sessions connected longer so MCP remains useful.

## Global Constraints

- Keep existing admin session work intact.
- Preserve authorization code PKCE and existing access token lifetime.
- Do not run the admin build.
- Keep OAuth and MCP interfaces synchronized.

## Review Focus

- Refresh token replay must fail.
- A disabled or removed client must not refresh.
- A client that loses `mcp` scope must not refresh.
- Revocation must accept refresh tokens.
- Refresh must work after a database restart.

### Task 1: Long lived OAuth renewal

**Files:** `libs/database.js`, `libs/oauth-service.js`, `server/oauth.js`, `test/integration/oauth.test.js`, `README.md`.

**Interfaces:** `exchangeRefreshToken({ refreshToken, clientId })` returns the same token response shape as code exchange, including a replacement `refresh_token`; `revokeOAuthToken(token)` revokes either token type.

- [x] Add integration tests for code exchange returning a refresh token, refreshing it, rotation and replay rejection, expiry, disabled client and scope rejection, and revocation.
- [x] Run the focused tests and confirm expected failures.
- [x] Add a SQLite migration for hashed refresh tokens and implement atomic rotation with a sliding 30 day expiry.
- [x] Add the refresh grant to the token endpoint and discovery metadata, and support refresh token revocation.
- [x] Update OAuth documentation.
- [x] Run focused tests, repository tests, lint, formatting, and diff checks; report any unrelated baseline failures.
