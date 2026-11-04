# Live Service Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live checks and administrator notices for the four media services.

**Architecture:** Persist sanitized status and notices in the existing SQLite store. A separate monitoring loop probes fixed configured services; authenticated UI polls cached measurements. Gateway diagnostics check its viewer and lineup without opening streams.

**Tech Stack:** Nuxt, Vue, Node 24, built-in SQLite, existing Zod and Cindor components.

**Spec:** `docs/superpowers/specs/2026-10-24-service-status-design.md` (approved).

## Global Constraints

- Checks every minute, ten-second service deadline, three-minute freshness deadline.
- Two failed measurements at least 60 seconds apart confirm an outage; a success recovers it.
- No remote mutations, stream tuning, mail, new dependencies, or changes to account grants.
- Authenticated visibility, admin diagnostics, origin enforcement, recent authentication for notice changes.
- Preserve unrelated pending work; implement in current feature checkout under the user's go-ahead. Commit/deployment are separate delivery states.

## Review Focus

- Repeated manual checks cannot accelerate outage confirmation.
- Restart/staleness/configuration changes invalidate previous confirmation state.
- Successful login pages and redirected requests must not count as healthy services.
- No raw upstream errors, destinations, credentials, or identities escape through diagnostics.
- Manual notices coexist with measurements; restore cannot republish historical incidents.

### Task 1: Measurement state and notice lifecycle

**Files:** `shared/service-status.ts`, `server/core/service-status.ts`, `server/core/db.ts`, `server/core/restore.ts`, `tests/service-status.test.ts`.

**Interfaces:** `ServiceStatus(db, probes, clock).check(force?)`, `.snapshot(admin?)`, `.saveNotice(input, actor)`, `.publishNotice(id, actor)`, `.resolveNotice(id, actor)`, `.deleteNotice(id, actor)`; probe definitions contain fixed fingerprint and async result function.

- [ ] Write failing behavioral tests for spaced confirmation/recovery, stale/restart/configuration reset, concurrency/cooldown, sanitation and notice lifecycle/restore.
- [ ] Run `node --experimental-strip-types --test tests/service-status.test.ts`; confirm missing implementation fails.
- [ ] Add migration, shared types and tested core operations. Persist safe diagnostic codes only. Reset saved measurements on runtime construction.
- [ ] Run the targeted suite to green.

### Task 2: Bounded probes and gateway diagnostics

**Files:** `server/core/status-probes.ts`, `integrations/iptv/health.mjs`, `integrations/iptv/gateway.mjs`, `server/core/config.ts`, Compose files, `.env.example`, `tests/status-probes.test.ts`, `tests/gateway-health.test.ts`.

**Interfaces:** `createStatusProbes(cfg): Record<ServiceId, Probe>` and private gateway `GET /internal/health`, authorized by existing shared key.

- [ ] Write local-fixture tests for valid responses, wrong identity/login pages, redirects, bounded bodies, deadlines, gateway authorization and component failures.
- [ ] Run targeted tests and observe missing behavior failures.
- [ ] Implement fixed destinations with safe diagnostics and overall deadline, verify deployed Seerr status contract against owning source, and configure private gateway URL.
- [ ] Run targeted suites to green.

### Task 3: Runtime/API and user/admin UI

**Files:** runtime/plugin/API wiring; `app/composables/useServiceStatus.ts`, `app/components/ServiceStatusPanel.vue`, `app/components/OutageNotices.vue`, `app/pages/admin/status.vue`, app shell/dashboard/admin links; `tests/integration/status-http.test.ts`.

**Interfaces:** authenticated `GET /api/status`; admin `GET /api/admin/status`, `POST /api/admin/status/check`, and notice save/publish/resolve/delete endpoints. Public rows omit diagnostics/fingerprints; admin rows include safe component details.

- [ ] Write isolated real HTTP tests using controlled probe servers for auth/origin/freshness, notices, SSR and sanitization; confirm red after building.
- [ ] Wire independent timer and routes. Add polling that refreshes visible tabs and ages measurements locally after a failed refresh.
- [ ] Add responsive accessible status panel, global notices and admin notice editor/history with escaped text.
- [ ] Run core tests, typecheck, build and HTTP tests; inspect user and admin UI in browser.

### Task 4: Review and delivery

- [ ] Update README with check scope, configuration, notice lifecycle and private diagnostic deployment boundary.
- [ ] Obtain a fresh implementation review, address material findings, rerun affected verification.
- [ ] Report implemented behavior, verification evidence and any production limitations.

## Execution ledger

Ruling: Execute natively in this existing feature checkout; user explicitly approved implementation, and pending guide/account changes must remain present. Avoid extra approval steps or unrelated commits.

Task 1: complete — measurement transitions, notices, migration and restore handling implemented. Failure confirmation uses the first failed-probe timestamp instead of a redundant integer counter; tests prove the required spaced confirmation and recovery behavior.

Task 2: complete — bounded probes, protected gateway diagnostics, Compose and gateway image wiring. Viewer validation requires the established Bulock Media title and Nuxt markup. Optional built-in landing-page mode remains supported. Deployment verification found that Seerr 3.3.0 rejects the development source's `checkUpdateAvailable` parameter; the probe now uses standard `/api/v1/status`, with a regression fixture for the deployed contract.

Task 3: complete — independent monitor loop, authenticated APIs, public status panel, global notices, and admin editor/history. Browser verification covered desktop and 390px phone layouts and saving/publishing/resolving a notice using an isolated temporary database and fake services. Browser warning/error log was empty.

Task 4: complete — fresh reviewer found viewer-page validation and admin clock-skew issues; both fixed and regression-tested. Reviewer verified the fixes with no remaining material finding. README and routing example describe the private diagnostic boundary and deployment requirements.

Final verification: 83 tests passed, including both real HTTP integration suites; TypeScript checks passed; production build passed; git diff whitespace check passed (only an existing CRLF warning in unrelated main.css). Build reports the expected external node:sqlite dependency. All service network fixtures were local; no live production probes, notices, or accounts were created.

Ruling: Leave the mixed working tree uncommitted and undeployed. No merge/push/release was requested; unrelated guide/account/style/deployment-note work remains intact. Release requires both updated portal and gateway, migration 7, private gateway-origin configuration, and the documented reverse-proxy restriction. Live service endpoint validation remains a release check.

Deployment authorization: the user subsequently requested deployment and live verification. The feature-only overlay was staged over verified matching production source, with online SQLite backups and rollback portal/gateway image tags. Portal and gateway were replaced; viewer uptime, production environment and unrelated source were preserved. See `docs/deployment-status.md` for release details and final live evidence.

Deployment complete: final Docker build, 81 core tests, both HTTP integration tests and type checks passed. Corrected the Seerr probe using the deployed API contract. All four services responded across two observed scheduled cycles 60 seconds apart; Live TV gateway/viewer/lineup checks passed. Schema 7 integrity, preserved records/source/environment, public access boundaries and enabled private diagnostic routing verified. Rollback images and online database backups retained. No production notices, login sessions, or accounts created for verification.

All pending work subsequently committed and pushed in `eaecbf9` on `codex/plex-setup`, then deployed as a complete source snapshot. This includes later Cindor form and preview-spacing polish, plus the separately approved self-service activation change. The combined release passed 85 core tests, both HTTP integration tests, type checks and builds; all live measurements remain responding. See `docs/deployment-status.md`.
