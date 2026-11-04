# UX Audit Improvements Implementation Plan

> **For agentic workers:** Apply the approved audit in this chat. Use focused parallel work for independent components and test behavioral changes before integrating them.

**Goal:** Make routine channel administration clearer and more compact while retaining the dark theme, orange accent, and draft/review safeguards.

**Architecture:** Keep the existing Vue/Cindor interface and API contracts. Extract small pure helpers for presentation, navigation, and refresh outcomes where they improve behavioral testing. Do not add dependencies or alter production configuration.

**Tech Stack:** JavaScript ESM, Vue 3, Cindor, Mocha/Chai, Vite development server.

**Spec:** User-approved UX audit in this chat, 2026-11-04. Prioritize the five high-priority findings, then visual consistency and closely related medium-priority fixes.

## Global Constraints

- Keep the current dark theme and orange accent.
- Never run the admin build; validate Vue via compilation and the isolated Vite fixture.
- Preserve channel drafts, shared/lineup scope, and save review.
- No production writes, deployment, dependency changes, or server API changes.
- Work in the existing clean feature checkout; preserve any concurrent changes.

## Review Focus

- Partial refresh failure must remain visible regardless of completion order.
- Native media errors and retry must not leak callbacks into another channel.
- Excluded channels must remain discoverable without inflating attention counts.
- Browser history and reload must preserve valid section context without losing drafts.
- Mobile layout, long URLs, and long dropdown choices must remain usable.

## Tasks

- [x] Channel workflow: separate available channels from included channels needing attention; searchable grouped stream/guide choices; compact list and editor; selected-channel preview callback; retain accessible keyboard behavior. Add behavioral tests for filters/options.
- [x] Sources/settings: readable source summaries and focused editing, source-specific accessible labels, consistent headings and compact settings sections; retain validation and draft semantics.
- [x] Runtime fixes: independent refresh outcomes and retry, explicit native player failure/retry, distinct guide/preview read failures, fix preview profile change loading. Add regression tests at helper boundaries and exercise fixture UI.
- [x] Shell/polish: Channels landing, Settings naming, URL-backed section navigation, consistent page headings, readable operational dates/schedules, actionable health filters, improved typography/contrast/spacing.
- [x] Verification: focused tests, non-integration and integration suites, lint, Vue SFC compilation, isolated fixture desktop/mobile checks, final independent review. Record failures/limitations honestly; no admin build.

## Progress

- Initial audit revalidated against clean feature branch `codex/remaining-guide-work`, baseline `887533c`.
- Ruling: implement the approved audit directly without another design approval; the user explicitly requested implementation and fixed the visual direction.
- Ruling: use existing checkout and installed dependencies rather than introduce worktree/dependency churn for an already authorized local change.


## Verification results

- Focused UX regressions: 27 passing. Covers partial refresh outcomes, native media cleanup, section parsing, health identity ambiguity, backup timestamps, channel attention and source selection, and existing draft/provider behavior.
- Full non-integration suite: 235 passing using installed ARM64 Node 24.19.0 with loopback access.
- Full parallel integration suite: 238 passing, 2 failing. Both canonical-routes assertions (lines 169 and 480) reproduce on clean baseline HEAD 887533c in an isolated TEMP git archive (7 passing / same 2 failing). No server code changed in this work.
- Focused ESLint: no errors. All five Vue SFC scripts/templates/styles compile. git diff --check passes. No admin build run; tracked public/admin assets remain untouched.
- Independent review caught and resolved degraded HTTP 207 EPG outcomes and stale codec probes across playback retries. Follow-up review found no further actionable issues.
- Browser fixture checks: Channels default; section URLs, reload and Back; source add/type/validation/remove; mixed refresh success/failure and retry; saved preview profile switch; native HLS failure/retry; distinct guide error and successful programme loading; health filters/counts and correct-channel editing; grouped source search with selected choice retained; mobile channel draft/review/save; Settings disclosure/save; readable task and backup data.
- Desktop screenshots inspected with final dark/orange palette, 15px base typography, and brighter secondary text. Final Channels first row at approximately y479 in the desktop fixture versus approximately y600 in the audit.
- At 390px, mobile navigation/filter controls and editor were exercised with no document overflow. First row measured approximately y555 before the final 1px base-font adjustment, versus approximately y760 in the audit. Mobile screenshot capture timed out in the browser backend; responsive verification used accessibility state and DOM geometry. Viewport override reset afterward.
- Synthetic fixture streams deliberately fail; successful playback against live providers was not tested with these local changes. Production data/configuration was not changed.
- Local preview uses installed x64 Node 22.14.0 for the existing x64 Vite native dependency; server tests use ARM64 Node 24.19.0 for the existing SQLite dependency. No dependencies changed.
