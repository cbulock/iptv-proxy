# IPTV Proxy Web App Design Plan

## Problem

Design a web app that can ingest multiple IPTV channel sources and programme-guide sources from local or remote locations, combine them into a single remotely consumable output, and let operators control how channels are assigned in that output. Then compare that target design to the current app and identify the changes needed to improve the existing codebase.

This document is a **planning artifact only**. It does not authorize implementation work.

## Current State Analysis

### What the current app already does well

- The server already supports the core product goal at a basic level:
  - multiple providers in `config/providers.yaml`
  - optional provider-level EPG URLs
  - merged playlist output at `/lineup.m3u`
  - merged guide output at `/xmltv.xml`
  - remote stream access through `/stream/:source/:name`
- The app already considers reverse-proxy deployment:
  - `libs/getBaseUrl.js` honors `X-Forwarded-*` headers
  - playlist and XMLTV output are rewritten to use the public base URL
  - image URLs are proxied
- There is already an authenticated admin UI:
  - Vue 3 single-screen admin in `admin/src/App.vue`
  - provider editing
  - mapping editing
  - preview/watch flow
  - health, scheduler, cache, usage, and backup features
- Channel normalization exists:
  - `scripts/parseM3U.js` merges provider channels into `data/channels.json`
  - `libs/channel-mapping.js` applies name/tvg-id/guide-number-based overrides
- The app has some operational safeguards:
  - rate limiting
  - auth + CSRF for admin APIs
  - SSRF checks on `?upstream=` stream fetches
  - tests around lineup, EPG, MCP, auth, usage, and stream behavior

### Main design weaknesses in the current app

1. **The domain model is too flat.**
   - Providers, source channels, canonical channels, output channels, and mapping rules are effectively collapsed into a single parsed channel list plus a flat `channel-map.yaml`.
   - This makes complex channel assignment workflows harder than they need to be.

2. **The config model is split and drifting.**
   - Runtime uses `providers.yaml` as the main multi-source model.
   - Other APIs and preview flows still depend on legacy `m3u.yaml` and `epg.yaml`.
   - `status.js` also reports legacy config structures, which makes the architecture inconsistent.

3. **The app is YAML-first rather than product-model-first.**
   - The admin UI is mainly an editor over files.
   - There is no stronger persisted model for source credentials, source health history, mapping decisions, draft changes, or publish history.

4. **Channel assignment is override-based, not workflow-based.**
   - Current mapping is a key/value override file.
   - There is no first-class concept of:
     - canonical channel records
     - source-to-canonical bindings
     - source priority/fallback
     - conflict resolution state
     - lineup slots/output profiles

5. **Remote streaming support exists, but only at the stream-proxy layer.**
   - `/stream/:source/:name` makes upstream streams remotely reachable.
   - There is not yet a richer source capability model for auth methods, transcoding policy, HLS/native compatibility, timeout policy, or per-source failover behavior.

6. **The admin app is becoming monolithic.**
   - `admin/src/App.vue` is a large all-in-one screen managing many unrelated concerns.
   - This will slow down feature work on source onboarding, mapping workflows, and publishing.

7. **The current system publishes one merged view, not managed outputs.**
   - The app exposes one main merged lineup/guide.
   - A better design would treat the published lineup as an explicit output profile with rules, ordering, inclusion, and publication state.

## Proposed Target Design

### Core product model

Build the web app around these first-class entities:

- **Source**
  - provider type (`m3u`, `hdhomerun`, future source types)
  - local/remote location
  - channel feed URL
  - guide URL(s)
  - auth/headers/connection policy
  - health and last sync status
- **Source Channel**
  - raw channel discovered from a source
  - raw metadata (`name`, `tvg_id`, logo, group, guide number, stream URL)
  - probe metadata (stream format, browser compatibility, reachability)
- **Canonical Channel**
  - normalized channel identity used by the app
  - canonical name, number, logo, guide id, group, published state
- **Channel Binding**
  - explicit relationship between a source channel and a canonical channel
  - preferred source, fallback source(s), conflict status, confidence/suggestion state
- **Guide Source / Guide Binding**
  - source guide configuration and canonical channel linkage
  - source priority and dedupe rules
- **Output Profile**
  - one publishable remote output
  - included channels, ordering, numbering, groups, stream policy, guide policy, endpoint settings

### Recommended user workflows

1. **Connect sources**
   - Add local or remote IPTV/HDHomeRun sources.
   - Test connectivity and credentials.
   - Preview discovered channels and guide coverage before saving.

2. **Normalize and bind channels**
   - Show unmatched/conflicting channels in a queue.
   - Let the operator accept suggestions, merge duplicates, choose preferred source, and assign channel numbers.

3. **Publish remote outputs**
   - Generate one or more published outputs that always use proxied public URLs.
   - Keep output URLs stable even when upstream source URLs or internal IPs change.

4. **Operate and monitor**
   - Track sync runs, health, guide freshness, active streams, and publish errors.
   - Support draft vs published changes, backups, and rollback.

### Backend design direction

- Introduce a service/domain split:
  - **ingest services** for sources and guides
  - **domain services** for canonical channels, bindings, numbering, and publication
  - **delivery services** for lineup/EPG/stream/image output
- Move from “parse files into one JSON snapshot” toward:
  - source records
  - discovered channel records
  - canonical channel records
  - publishable output records
- Keep public delivery endpoints stable:
  - `/lineup.m3u`
  - `/xmltv.xml`
  - `/stream/...`
- Add explicit publish semantics so the app can distinguish:
  - discovered state
  - draft edits
  - published lineup state

### Frontend design direction

- Break the admin UI into focused sections/components:
  - Sources
  - Channel Inbox / Matching
  - Canonical Channels
  - Outputs / Publishing
  - Monitoring
  - Settings
- Replace generic YAML editing as the main experience with task-driven workflows.
- Keep advanced raw-config import/export as an expert feature, not the primary UX.

## Comparison: Target Design vs Current App

| Area | Current design | Better target design | Needed change |
| --- | --- | --- | --- |
| Source model | Flat provider entries with optional EPG | Explicit source records with connectivity, auth, health, capabilities | Expand provider model into a richer source domain |
| Channel model | Parsed channel objects + flat mapping overrides | Source channels + canonical channels + bindings | Add first-class canonical/binding layer |
| Mapping | YAML override file keyed by name/tvg-id | Reviewable assignment workflow with suggestions and conflicts | Replace file-only mapping UX with workflow-based channel assignment |
| Output | One merged lineup/guide | Managed output profiles with stable publication | Add output profile/publish layer |
| Persistence | YAML + generated `channels.json` + in-memory state | Durable app state for syncs, bindings, drafts, and publishing | Introduce a stronger persistence model |
| Admin UI | Large single-file admin console | Modular workflow-oriented app | Split `App.vue` and redesign navigation/features |
| Config architecture | Mixed `providers.yaml` + legacy `m3u.yaml`/`epg.yaml` | One coherent config/domain model | Remove config drift and consolidate APIs |
| Operations | Good base observability | Rich sync, publish, and assignment lifecycle visibility | Extend status/history around ingest and publish lifecycle |

## Recommended Changes to the Current App

### Phase 1: Consolidate the architecture around providers/sources

- Make `providers.yaml` the single source-oriented config surface if file-based config is retained.
- Deprecate or remove legacy `m3u.yaml` and `epg.yaml` dependencies from:
  - preview APIs
  - config APIs
  - status reporting
- Introduce one normalized backend representation for:
  - sources
  - source channels
  - canonical channels
  - output channels

### Phase 2: Add canonical channels and bindings

- Create a canonical channel model separate from raw source channels.
- Replace flat override-only mapping with:
  - source channel matching suggestions
  - explicit accept/reject actions
  - preferred source selection
  - channel-number assignment as a first-class workflow
- Preserve existing mapping import/export compatibility during migration.

### Phase 3: Add output/publishing concepts

- Represent the published lineup as an output profile, not just a generated side effect.
- Support:
  - channel inclusion/exclusion
  - source fallback
  - numbering/order
  - guide source preference
  - stable public publication URLs

### Phase 4: Strengthen remote-delivery behavior

- Keep the current proxy-first delivery model for remote consumption.
- Extend it with per-source policies for:
  - timeout/retry behavior
  - redirect handling
  - auth/header handling
  - browser preview/transcode compatibility
  - source capability flags

### Phase 5: Refactor the admin app

- Split `admin/src/App.vue` into feature modules/components.
- Add dedicated screens for:
  - source onboarding/testing
  - unresolved channel conflicts
  - canonical lineup management
  - output publishing
- Keep advanced diagnostics, backups, scheduler, and cache management as secondary operational views.

### Phase 6: Improve persistence and lifecycle management

- Introduce durable storage for:
  - source definitions
  - sync history
  - canonical channels
  - channel bindings
  - output profiles
  - publish history
- Treat YAML import/export as compatibility/migration tooling if the app moves beyond file-backed config.

## Suggested Implementation Sequence

1. **Model cleanup**
   - Define target entities and remove config drift between `providers`, `m3u`, and `epg`.
2. **Backend refactor**
   - Split ingest, mapping, publishing, and delivery concerns into clearer services/modules.
3. **Channel assignment workflow**
   - Build canonical channel + binding APIs.
4. **Publishing layer**
   - Add output profiles and publish lifecycle.
5. **Admin UI redesign**
   - Replace file-editor-centric views with operator workflows.
6. **Migration and compatibility**
   - Preserve current public endpoints and offer import/export for existing YAML setups.

## Likely Code Areas Affected

- `index.js`
- `libs/config-loader.js`
- `libs/channel-mapping.js`
- `scripts/parseM3U.js`
- `server/config.js`
- `server/channels-management.js`
- `server/mapping.js`
- `server/preview.js`
- `server/status.js`
- `server/epg.js`
- `server/lineup.js`
- `server/mcp.js`
- `admin/src/App.vue`
- new backend modules for source/channel/output domain logic
- new frontend components/views for source, matching, and publishing workflows

## Planning Notes

- The current app already proves the core idea, so the recommended direction is **evolutionary refactor**, not a rewrite.
- Preserve public delivery routes and existing file compatibility wherever possible during migration.
- The biggest immediate improvement is to stop treating channel assignment as a flat YAML override problem and instead make it a first-class workflow with canonical channels and output profiles.
- The biggest architectural cleanup is to remove the split between legacy config files and the current provider-based model.
- Planned persistence direction: **hybrid, file-first now and database later**.
  - Near term: keep YAML import/export and avoid forcing a hard migration.
  - Medium term: introduce an internal persistence boundary so source, channel, binding, and output state no longer depends on direct file edits.
  - Long term: move the control plane to durable structured storage without breaking existing published endpoints.

## Resolved Question

- Optimize for a **hybrid path**:
  - start by keeping the app file/YAML-compatible
  - refactor the domain model and APIs so they are no longer tightly coupled to YAML files
  - make a later move to database-backed persistence incremental rather than disruptive
