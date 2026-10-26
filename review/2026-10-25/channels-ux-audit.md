# Channels UX audit

Date: 2026-10-25

## Scope and evidence

Reviewed the authenticated live Channels tab at `https://iptv.bulock.house/admin/`, its rendered accessibility tree, search/filter interactions, desktop layout, and a temporary 390 x 844 viewport. Reviewed the Vue components, draft persistence, save/load handlers, and output-profile service. Restored the original viewport and cleared the audit search/filter.

Observed live state: one Default Output profile, 89 channels, 26 enabled, 6 with multiple sources, and a displayed count of 0 guide warnings. There were 63 disabled channel-enable switches. These are observations from this session, not permanent inventory counts.

No production settings were changed. Save, reload, delete, and error-path behavior were traced in source rather than executed against production. This is an expert UX audit, not a user study or a complete assistive-technology compliance test. No admin build was run. Existing EPG changes in `server/epg.js` and `test/integration/guide.test.js` are unrelated and were left alone.

## Overall diagnosis

The page makes users understand internal configuration concepts before they can manage a channel. Profile administration, client connection URLs, refresh jobs, channel selection, shared source settings, and technical metadata compete for the same visual priority. More explanatory paragraphs will not solve that structure.

The primary workflow should be: choose a lineup, find a channel, include or exclude it, adjust details when necessary, review and save. Troubleshooting should show a specific problem with a next action.

## Findings

Priority: P1 means misleading state, possible lost work, or unclear change scope; P2 means substantial navigation/interaction friction; P3 means supporting polish.

| Priority | Finding and evidence | Impact | Recommended correction |
| --- | --- | --- | --- |
| P1 | Refresh directly calls `loadChannelAuthoringData`, which replaces canonical data, resets channel drafts, and reloads profile entries. Reload Channels also calls it. Neither toolbar path checks dirty state. | Unsaved edits can be replaced by a routine-looking action. Local draft persistence does not protect drafts from these explicit resets. | Guard destructive reloads. Offer Save and continue, Discard and continue, or Cancel; preserve edits on failed saves. Disable conflicting actions while saving/loading. |
| P1 | Name, preferred stream, and guide source update canonical records shared across profiles; inclusion and number overrides update only one profile. All appear under one selected output profile with no scope distinction. | A user can reasonably believe a channel rename or source change affects only the selected lineup. | Separate “In this lineup” from “Shared across all lineups” in channel details and change review. Preserve existing server semantics. |
| P1 | “Guide warnings: 0” and the Guide warnings filter show no issues, despite 63 disabled enable switches and rows marked Missing. The counter only checks missing numbers on entries already enabled. | Users receive an all-clear signal while being unable to add channels. It also suggests schedule validation that is not performed. | Separate “Needs channel number” from “No guide selected.” Explain “Assign a channel number to add this channel.” Do not claim programme coverage without actual guide data. |
| P1 | Endpoint availability is derived from `selectedOutputProfile`, which overlays unsaved enabled state onto the saved profile. | On a named profile, “Active” or “Disabled” can describe a draft rather than the published state. Source-confirmed; no named profile was created to reproduce live. | Report saved publication status separately from pending changes. |
| P2 | At the normal desktop viewport, the initial screen contains no channel rows; search is at its lower edge. Slug, editing instructions, endpoint URLs, repeated summaries, and statistic cards precede the list. | The page's main task is pushed below administrative information. | Put lineup selection, search, filters, and compact channel rows first. Collapse lineup settings and client URLs. |
| P2 | Every row is a five-control form with metadata, source names, source references, and a Saved badge. MeTV repeats Antenna three times before the stream choices repeat it again. | Scanning channels requires reading a configuration form; keyboard users encounter hundreds of controls. | Render names and current settings as readable summaries. Open an explicit Edit panel for infrequent changes. Keep inclusion readily available. |
| P2 | Search for MeTV finds channel 11. Search for 11 does not find MeTV; it finds GREAT through upstream reference 49.11. `filteredRows` omits the effective lineup number. | The number users see in their TV app does not find that channel. | Search display name, effective number, original name, provider, and technical IDs. Prefer exact number matches where practical. |
| P2 | GREAT displays “No stream choices” and “No guide choices,” while each dropdown actually contains a choice. The empty-value option always uses the no-choices label. | An unselected setting is misrepresented as unavailable. | Distinguish “Choose a stream,” “Choose a guide,” and genuinely unavailable options. Show source names in summaries and IDs in details. |
| P2 | Save is only at the top. There is no explicit Discard action. Profile switch/create/duplicate are refused when dirty with a toast telling the user to save. | Users deep in the list must travel back to save and cannot deliberately abandon a draft through a clear control. | Persistent change bar with changed-channel count, Review changes, Discard, and Save changes. Provide a recoverable decision when changing lineups. |
| P2 | The table re-sorts by effective number as a number override is committed on blur. | The row being edited can move while the user is working through it. This is source-derived behavior. | Keep the active editor stable; apply sorting on explicit sort changes or after saving/closing the editor. |
| P2 | At 390 x 844 the table begins about 2,393 CSS pixels down the document; the page is about 50,280 pixels tall. Toolbar controls stack, and each channel becomes a complete vertical form. | Mobile browsing involves extensive scrolling before and between channels. | Compact responsive rows, one editor at a time, compact top navigation, and reachable save controls. Avoid a full settings form for every channel. |
| P2 | “Refresh,” “Reload Channels,” and “Reload EPG” sit together without explaining their different effects. | Users must guess whether an action rereads saved configuration, contacts providers, or refreshes schedules. | Use “Refresh view,” “Rescan sources,” and “Update TV guide,” with short explanations in a maintenance disclosure/menu. |
| P2 | Several polite live regions repeat counts/status. `aria-describedby` repeats the long toolbar explanation on many controls; guide-source selects reference number-help text. Disabled inclusion switches reference source details rather than why they are disabled. | Accessible names exist, but announcements can be repetitive or irrelevant. | Keep concise visible labels, one results announcement, targeted inline validation, and help associated with the actual control. Verify with keyboard and a screen reader during implementation. |
| P2 | Save creates `new Error(buildApiErrorMessage(...))`, then its catch checks `e.channelId`; the service returns `canonicalId`, and the shown failure path does not preserve it on the Error. | Channel-specific validation can become a global toast instead of marking the row that needs repair. Source-confirmed; failures were not induced in production. | Preserve structured error identity, highlight the affected channel/field, and keep drafts available for correction. |
| P3 | Canonical Channels, TVG ID, Slug, Editing model, Guide Number, and Public Endpoints are exposed as primary vocabulary. “Enabled” refers both to a profile and a channel. | Users must translate technical terms and infer the scope of switches. | Use Channels, Lineup, Channel number, Include in lineup, TV guide, and Connect a player. Retain technical identifiers under details. |
| P3 | Client URLs are text-only and permanently expanded. There is no clear-filter action, sorting control, or bulk inclusion workflow. | Routine copying, recovery from zero results, and larger edits take unnecessary effort. | Add Copy buttons, Clear filters, explicit sorting, and later scoped bulk actions after the basic flow is verified. |

## What already works and should be retained

- The server saves profile and canonical changes in a transaction.
- Changes are staged and dirty-state tracking exists; draft snapshots support session recovery.
- Search includes original names and provider references.
- Controls have accessible names, table headings, and textual status, rather than relying only on color.
- Default-profile deletion/disable protections already exist.
- Mobile has a card fallback; it needs less content per card rather than a wholesale loss of functionality.

## Redesign options

1. **Compact list with channel details — recommended.** Keep inclusion, channel number, name, source summary, and actionable status in a scannable list. Open an Edit panel for a channel's settings. This reduces the initial information load and fits mobile; occasional source/guide edits require one extra click.
2. **Streamlined spreadsheet.** Retain inline fields, collapse the page header, add explicit scope labels, sortable columns, safe save/discard, and better filters. This benefits sustained bulk editing but retains a dense keyboard path and more difficult mobile experience.

A mandatory step-by-step wizard is a poor default for recurring channel maintenance: it would add navigation to small edits. A short empty-state setup checklist can still help first-time users.

The user selected option 1, the compact list with a channel Edit panel, during this session. Detailed design: `../../docs/superpowers/specs/2026-10-25-channels-ux-design.md`.

## Recommended screen structure

```text
Channels                         Lineup: Default Output
Choose which channels appear in this lineup.
                         [Lineup settings] [Connect a player]

[Search name, channel number, or source...]
[All] [In lineup] [Not in lineup] [Needs setup] [Changed]
Source: All sources                 Sort: Channel number

Include   Number   Channel        Source       Setup       Action
On        11       MeTV           Antenna      Ready       Edit
Off       —        GREAT          Antenna      Needs #     Set up

Persistent when dirty:
3 channels changed           [Review changes] [Discard] [Save changes]
```

The Edit panel should show two clearly labeled sections:

- **In this lineup:** inclusion and channel-number override, with the inherited number and a Reset to default action.
- **Shared across all lineups:** display name, stream source, and TV guide source. Explicitly state the scope beside the controls.

Technical identifiers and complete source bindings belong in an expandable details section. Closing the panel keeps staged edits; Save changes remains the single commit action. This avoids introducing a second ambiguous save layer.

Keep all channels discoverable. A first implementation can default to All with a prominent In lineup filter; hiding unconfigured channels by default risks making setup harder to discover. A Needs setup filter must explain why a channel appears and include a direct correction path.

## Implementation boundaries

- Retain Vue Composition API, JavaScript ESM, and existing Cindor components.
- Most work belongs in `admin/src/components/ChannelsPane.vue`, with draft protection/error/scope work in `admin/src/App.vue` and small testable helpers under `admin/src/utils/`.
- Preserve canonical IDs, existing database relationships, local-network support, and API payloads. Renaming UI labels does not require renaming APIs.
- If implementation changes an API or data shape, update `server/mcp.js` and `test/integration/mcp.test.js` together.
- Never run the admin build. Validate with the Vite development server, Vue compilation checks, targeted lint, meaningful helper tests, and browser exercises.
- Treat actual programme availability as separate future data work if the current authoring payload cannot support it. A selected guide binding alone is not proof of programme data.
- Keep ordering changes and broad bulk-management additions out of the first pass unless selected explicitly; fix the core workflow first.

## Acceptance checks for the implementation

1. On desktop, channels and search are visible without scrolling past administrative cards.
2. At 390 pixels wide, the page has no horizontal overflow; channel summaries are concise, edit controls fit, and Save/Discard remain reachable.
3. Searching 11 finds MeTV when its effective channel number is 11; name/provider searches still work.
4. A channel without a number explains the prerequisite and can be opened directly to the number field. The setup filter includes it.
5. Empty source selections say Choose when options exist and No available sources only when none exist.
6. Shared versus lineup-only changes are explicit before saving, including in any change review.
7. Refresh, rescan, profile switching, and navigation through create/duplicate cannot silently erase drafts. Failed saves retain edits.
8. Discard restores profile metadata, names, source/guide selections, inclusion, and uncommitted number text; recovered local drafts are cleared consistently.
9. Published endpoint status continues to reflect persisted state while enable/disable is pending.
10. A number edit does not cause the open editor to jump to another channel.
11. Keyboard users can open/close an editor, retain focus on return, review validation, and save without traversing controls for every channel. Announcements are concise and relevant.
12. Server validation identifies the channel needing correction. No success message appears if the intended save failed; a failed post-save refresh is distinguished from a failed write.
13. Default-profile restrictions remain explicit, and existing MCP/API tests continue to pass if their surfaces change.

## Source pointers

- `admin/src/components/ChannelsPane.vue:3` — toolbar and header hierarchy.
- `admin/src/components/ChannelsPane.vue:264` — complete editable table per channel.
- `admin/src/components/ChannelsPane.vue:475` — search and filter behavior.
- `admin/src/components/ChannelsPane.vue:941` — small-screen layout rules.
- `admin/src/App.vue:1732` — authoring reload resets drafts.
- `admin/src/App.vue:1888` — channel/EPG refresh actions.
- `admin/src/App.vue:2170` — profile switching guard and channel draft updates.
- `admin/src/App.vue:2419` — combined save and error handling.
- `admin/src/App.vue:3511` — selected profile overlays unsaved metadata.
- `admin/src/App.vue:3619` — endpoint presentation.
- `admin/src/App.vue:3708` — number-derived warnings.
- `admin/src/App.vue:3756` — workflow row state, switch gating, and sorting.
- `libs/output-profile-service.js:522` — transaction and shared versus profile-specific persistence.
