# Channels UX Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved design task-by-task.

**Goal:** Implement the approved compact channel list, editor, setup guidance, and protected draft lifecycle.
**Architecture:** Keep the existing transactional API. Extract pure presentation/draft helpers, integrate lifecycle control in App.vue, and replace ChannelsPane with a compact list and focused dialogs.
**Tech Stack:** Vue Composition API, JavaScript ESM, Cindor, Mocha, Vite dev server.
**Spec:** ../specs/2026-10-25-channels-ux-design.md

## Global constraints

- No admin build; no generated public/admin changes.
- Preserve unrelated server/epg.js and test/integration/guide.test.js edits.
- No production settings, API changes, deployment, or new dependencies.
- User approved implementation; proceed inline without another planning approval.

## Review focus

- Missing/unselected source choices must differ from a genuinely empty list.
- Failed writes retain edits; successful writes with failed reads do not become failed saves.
- Discard restores unblurred number text and canonical/global edits as well as profile fields.
- Filtered-out editor rows retain identity and restore focus meaningfully.
- Refresh after source configuration changes must resolve drafts before the source mutation.

## Task 1: Workflow helpers and meaningful regression tests

Files: admin/src/utils/channel-workflow.js; test/unit/channel-workflow.test.js.
Interfaces: matchesChannelSearch(row, query), getChannelSetupIssues(row), buildChannelChangeReview(rows, profile, savedProfile), restoreChannelDrafts(state, savedProfile, savedEntries), resolveChannelDraftGuard({isDirty,prompt,save,discard}), saveChannelDrafts({write,acknowledge,reload}).
- [x] Write tests for effective-number lookup, missing number on excluded channels, unselected/empty choices, scoped before/after summaries, complete discard, cancel/failed-save guards, and failed post-save reload.
- [x] Run node node_modules/mocha/bin/mocha.js test/unit/channel-workflow.test.js; observe red.
- [x] Implement helpers and verify green with existing admin-draft tests.

## Task 2: App lifecycle integration

Files: admin/src/App.vue.
- [x] Integrate guarded refresh/switch/create/duplicate/delete/source-save, three-choice draft dialog, complete discard, saved publication state, structured save errors and retryable load failure.
- [x] Add baseline values to rows for change review and use staged numbers for setup state without auto-inclusion.
- [x] Compile source and run targeted lint/tests.

## Task 3: Compact list and editor

Files: admin/src/components/ChannelsPane.vue; optional ChannelEditor.vue.
- [x] Replace form-table/header cards with compact lineup controls, filters, readable rows, setup actions, disclosures, and copy feedback.
- [x] Add scoped editor and change review with persistent Save/Discard bar, disabled busy actions, meaningful empty/error states and focus restoration.
- [x] Compact mobile tab navigation and check Vue compilation/lint.

## Task 4: Browser validation and independent review

- [x] Run a local isolated fixture API and Vite dev server; exercise real App.vue at desktop and 390px mobile without production mutations.
- [x] Verify search, edit, review, cancel/discard/save, refresh safeguards, failure/retry, publication state and keyboard focus.
- [x] Run relevant unit/integration suite, inspect git diff, request fresh code review, fix important findings, and report local implementation status.

## Execution ledger

Ruling: work in the supplied feature-branch checkout; changes are confined to UI, new tests, and documentation, and unrelated EPG work is preserved. No extra worktree or branch is needed for these disjoint edits.
Ruling: keep changes reviewable and uncommitted until validation; no push/deployment requested.
Pre-flight: Tasks 2 and 3 consume Task 1 row helpers; baseline row values must be provided by App.vue and never inferred from draft display values.

Implementation completed locally. Pure helper tests were observed red before implementation, then green (13 workflow/draft tests). Independent code review identified a stale-snapshot risk after lineup deletion and a failed refresh; the selection now commits with the complete snapshot, and failed post-mutation reads lock editing until Retry succeeds. The real browser fixture reproduced the issue before the fix and verified recovery afterward.

Browser validation also identified and resolved Cindor select initialization mismatch, mobile section-picker mismatch, nested editor scrolling, and an ancestor overflow rule that prevented the Save/Discard bar from sticking. See the validation report for evidence and unrelated integration failures. No server APIs, generated assets, commits, or deployments changed.

Release follow-up: the user subsequently authorized commit, push, deployment, integration of the latest changes, and a one-time isolated asset build. Latest main and EPG-retention branches plus the deployed web-guide name fallback were integrated, tested, pushed, and deployed. The compiled assets were generated outside tracked public/admin. Candidate and live verification passed; see review/2026-10-25/channels-release.md for source revisions, checks, and rollback details.
