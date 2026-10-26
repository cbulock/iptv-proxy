# Channels: compact lineup list and channel editor

Date: 2026-10-25
Status: Approved by the user on 2026-10-25 and implemented locally. Validation is recorded in review/2026-10-25/channels-ux-validation.md.
Audit: `../../../review/2026-10-25/channels-ux-audit.md` (repository root: `review/2026-10-25/channels-ux-audit.md`).

## Intent

Make Channels easy to browse, configure, and troubleshoot without requiring knowledge of canonical channels, bindings, or output internals. The user requested a full UX audit and selected a compact list with a per-channel Edit panel over a streamlined editable spreadsheet.

This is a coordinated frontend redesign, including the draft behavior needed to make it safe and understandable. Retain existing backend publishing rules and the transactional save API.

## Approaches considered

- **Compact list plus editor — selected by the user.** A readable list handles discovery and inclusion. An editor exposes less frequent settings for one channel. Best fit for navigation, smaller screens, and explaining the scope of changes; costs an extra click for advanced edits.
- **Streamlined inline spreadsheet.** Faster for repeated field edits but retains much of the dense screen and keyboard navigation. Not selected.
- A setup wizard was ruled out as the main interaction because routine maintenance should not require stepping through a sequence.

## Main screen

1. A Channels heading and a short sentence explaining that a lineup controls what appears in a player.
2. A visibly labeled Lineup selector, saved publication status, Lineup settings disclosure, Connect a player disclosure, and secondary Maintenance disclosure. Retain existing profile names and slugs; change user-facing vocabulary only.
3. Search by channel name, effective number, or source. A filter control exposes All, In lineup, Not in lineup, Needs setup, and Changed, with counts. Default to All so unconfigured channels remain discoverable. Include Clear filters when active.
4. Compact channel list: inclusion control, effective channel number, readable channel name, concise source summary, setup/change status, and Edit or Set up action. No name input, source selector, TVG ID, repeated Saved badge, or source-reference paragraph in ordinary rows.
5. A persistent bar while dirty: changed-channel count, an indication of lineup-setting changes if applicable, Review changes, Discard, and Save changes. Saving disables conflicting edits/actions. Save remains reachable on narrow screens.

The default sort remains numerical channel order, then existing position/name tie-breaks. No new ordering backend behavior, drag sorting, or bulk-edit system in this pass. Show a multi-source count as secondary row information, not a large dashboard card. Source filtering and alternative sorting may be added later; search already covers source names.

## Channel editor

Open one channel at a time in an accessible Cindor dialog styled as an Edit panel. Use a wide panel on desktop and a full-width, vertically scrollable presentation on mobile. Keep the channel identity stable while editing; do not replace it when number-based row sorting changes.

The panel has two visible sections:

- **In this lineup:** Include in lineup, Channel number, inherited/default number, and Use default number. Explain that the number is what appears in the player. Entering a number satisfies the existing prerequisite for inclusion; never enable a channel automatically just because a number was added.
- **Shared across all lineups:** Display name, Stream source, and TV guide source. Say “Changes here apply to this channel in every lineup.” Preserve the existing global canonical semantics.

An optional Technical details disclosure contains canonical ID, original name, source bindings, and guide IDs for troubleshooting. When one source is available, show that fact plainly; an existing selection can be a summary, while an unset choice remains actionable. Use Choose a stream/Choose a TV guide when options exist. Use No stream available/No TV guide available only when the option list is empty.

Edits are staged immediately in the existing draft model. Done or closing the panel retains those drafts and explicitly says “Changes are kept as a draft until you save.” The panel does not add a separate server-save action. Provide a clear route to the main Save changes bar. Restore keyboard focus to the originating row action on close; if filtered out, focus the list heading/search instead.

## Setup and status

Replace the misleading Guide warnings metric with Needs setup. Derive explicit reasons from available authoring data:

- Missing effective channel number: show Assign a channel number. Keep the inclusion control disabled under the existing backend rule; put the reason next to it and in its accessible description. Set up opens the number field.
- No available stream or no explicitly selected stream: distinguish unavailable from unselected; do not imply that no choices exist when choices are present. Do not claim playback failure if the backend has a fallback.
- No selected guide binding: show No TV guide selected. This is advisory and does not add a new publishing restriction.

Needs setup includes rows with any of these reasons, whether currently included or excluded. Do not equate a selected guide binding with a populated schedule. Actual programme coverage requires other data and is outside this pass.

Changed indicates unsaved edits, separate from setup status. Status counts and labels follow staged row values, while publication status and active URLs describe saved profile state.

## Save, discard, and refreshing

Keep the existing combined transactional endpoint. No autosave. Review changes shows affected channels and before/after values, grouped by In this lineup versus Shared across all lineups, plus profile metadata changes.

Discard requires a clear application confirmation when edits exist and restores all draft fields from the last loaded/saved snapshot: name, preferred source, guide binding, inclusion, number override and uncommitted number text, and lineup metadata. Update local draft storage so discarded changes do not reappear after reload/login.

Before Refresh view, Rescan sources, selecting another lineup, creating, duplicating, or deleting a lineup, resolve dirty state with Save and continue, Discard and continue, or Cancel. A failed save cancels the pending action and retains drafts. Normal tab navigation can retain drafts as it does today; do not unnecessarily block it.

Protect all channel-authoring entry points, including source-save refreshes that invoke the same loader. Resolve channel drafts before writing source changes, not after the write when the follow-up rescan starts. The internal loader needs a deliberate distinction between a successful-save refresh and a user-triggered reload; it must not inadvertently re-prompt or reset newer edits. Disable competing mutations/loading actions during a save. Use one centralized guard where practical.

If a write succeeds but the follow-up read fails, say “Changes saved; could not refresh the list” and offer Retry refresh. Do not report a successful refresh or misrepresent the write as failed. Preserve server error identifiers for row/field-level feedback; also show a persistent summary and keep drafts on failed writes.

Maintenance explains:

- Refresh view: reread saved configuration.
- Rescan sources: discover channels again from configured sources.
- Update TV guide: refresh programme data. Preserve drafts; no authoring reload is needed solely to refresh EPG with the current API.

## Lineup settings and client connection

Lineup settings groups rename, enabled state, create, duplicate, and delete. Say that the default lineup is always available and cannot be deleted instead of showing unexplained disabled actions. Preserve delete confirmation and existing protection.

Connect a player contains the existing M3U, XMLTV, and JSON URLs, each with a Copy button and success/failure feedback. Label the common uses (playlist, TV guide, lineup JSON). Show saved availability separately from pending enabled changes. Do not claim URLs were checked merely because a profile is enabled.

## Empty states, responsiveness, accessibility

- No channels: explain how to configure Sources and rescan, with an actionable route.
- No results: retain query/filter state and offer Clear filters.
- Failed initial load: show Retry and an error, not a misleading no-channels state.
- Mobile: compact rows, readable source/status, easy Edit, no horizontal overflow, accessible scrollable panel and save bar. Compact the top tab navigation where necessary so it does not add another screen of vertical navigation.
- Keep semantic headings/table or list structure, visible labels, keyboard focus indication, a single concise results announcement, and precise help for each control. Cindor supplies dialog focus handling; verify it rather than assuming it works.

## Constraints and implementation ownership

Use Vue Composition API, JavaScript ESM, and the existing Cindor design system. Primary files: `admin/src/components/ChannelsPane.vue`, `admin/src/App.vue`, and small pure helpers under `admin/src/utils/`. Extract an editor component if it improves readability. No dependencies or backend migrations are needed for the intended scope.

Do not run the admin build or change generated public/admin asset references. Existing unrelated EPG modifications must be preserved. No deployment, provider rescan, actual production channel edits, or real player testing is implied by local UX implementation.

If an API capability/data shape must change, update `server/mcp.js` and its integration tests; otherwise retain the API unchanged. Keep local/private upstream addresses supported.

Builder choices: exact spacing, component boundaries, dialog/disclosure styling, responsive breakpoints, and concise wording refinements. Follow existing theme tokens and avoid speculative feature additions.

## Validation and completion criteria

Use the audit's 13 acceptance checks. Add meaningful tests around number search, setup reasons, complete draft reset, and shared-versus-lineup change summaries. Exercise dirty-state guards and save failure/retry with isolated fixtures; never test them by changing production settings. Compile Vue source/check targeted lint without the forbidden admin build. Use the Vite dev server and browser to verify populated/empty/error states, keyboard interaction, desktop, and 390-pixel mobile layout.

Completion means a working compact list and editor, clear scope and setup states, safe save/discard/refresh behavior, and validated local changes. Report validation and any remaining limitation separately from deployment status.
