# Live TV Self-Service Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Live TV immediately while reserving revoked-access restoration for admins.

**Architecture:** Keep `Iptv.request(id)` and the existing HTTP endpoint, but validate the account and approve eligible grants atomically. Use a one-time Store migration for enabled accounts with pending grants; credentials remain lazy.

**Tech Stack:** Nuxt, Vue, TypeScript, SQLite, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-24-iptv-self-service-design.md`

## Global Constraints

Preserve unrelated workspace edits. No self-restoration of revoked access. No activation of disabled accounts. No deployment.

## Review Focus

Repeated clicks preserve credentials and viewer sessions; migrations skip revoked/disabled accounts and run once; direct API calls cannot bypass revocation; all three user surfaces explain revoked access; admin restoration remains available.

### Task 1: Activation and pending migration

- [x] Add service tests for immediate activation, repeated activation, pending activation, disabled accounts, revocation and admin restoration.
- [x] Add an on-disk migration test for pending, disabled, revoked and untouched grants and repeat startup.
- [x] Run the tests and confirm failures against the old behavior.
- [x] Modify `server/core/iptv.ts` and add migration 8 to `server/core/db.ts`.
- [x] Run service and migration tests.

### Task 2: User-facing controls and validation

- [x] Update `ServiceDashboard.vue`, `account.vue`, `LiveTvGuide.vue`, admin wording and README for activation and admin restoration.
- [x] Update HTTP integration coverage for activation, revoked denial, admin restoration and rendered states.
- [x] Run unit tests, typecheck, build and HTTP integration tests; inspect final diff.

## Verification

All 85 unit tests, both HTTP integration tests, typecheck, production build and git diff --check passed. Localhost tests required unsandboxed execution because the sandbox returned EACCES on loopback connections. The four activation regression tests failed for the expected missing behavior before implementation and passed afterward. No live database changes or deployment were performed.

Ruling: implement in the existing workspace to preserve and build upon preexisting uncommitted guide/status edits; no commits, branch changes, or deployment. User explicitly approved the activation behavior and requested implementation.

Subsequent user authorization requested all pending work pushed and deployed. Included in commit `eaecbf9` on `codex/plex-setup`, pushed to origin and deployed on 2026-10-24. Local and Docker-host checks passed all 85 core tests, both HTTP integration tests, type checking and production builds. Migration 8 activated one eligible pending grant; existing users, other grants and stored credentials were verified unchanged. See `docs/deployment-status.md` for release and rollback details.
