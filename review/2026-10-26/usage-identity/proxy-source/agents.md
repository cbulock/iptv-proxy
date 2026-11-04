# agents.md

# Copilot Project Instructions — IPTV Proxy

## Purpose

This project builds a Node.js IPTV proxy that aggregates multiple live-TV sources (M3U playlists and HDHomeRun tuners), merges EPG (XMLTV) data, and exposes a unified lineup compatible with IPTV clients.

Copilot should help extend and maintain this codebase in JavaScript (ESM).

---

## Architecture Overview

- **Runtime:** Node.js ≥ 20
- **Admin UI** Vue.js 3
- **Framework:** Express
- **Config:** YAML files in `/config`
- **Logging:** Pino
- **Testing:** Vitest + supertest
- **Style:** ESLint + Prettier (flat config)
- **ESM imports only**

### Folder Layout

/src
/server
app.js
routes/
services/
sources/
epg/
mapping/
proxies/
utils/
/config
sources.yaml
mapping.yaml
epg.yaml
/scripts
ingest-epg.js
validate-config.js

---

## Core Behaviors

### Endpoints

| Route                | Description               |
| -------------------- | ------------------------- |
| `/discover.json`     | HDHomeRun discover format |
| `/lineup.json`       | HDHomeRun lineup format   |
| `/stream/:channelId` | Proxy upstream stream     |
| `/images/*`          | Proxy channel logos       |

### Mapping Rules

- **Canonical channel ID** (e.g., `23.1`) is the stable exposed identifier.
- Match priority:
  1. Explicit `mapping.yaml` entry
  2. Optional match by number + callsign
  3. Otherwise excluded until mapped.

### EPG Merge Rules

- Combine multiple XMLTV sources (URLs or local files).
- Deduplicate `<programme>` by `(channel, start, title)`.
- Keep higher-priority source on conflicts.
- Preserve `<channel id="23.1">` unchanged.
- Output merged file at `data/merged.xml`.

---

## Implementation Guidelines

- Prefer **pure functions** for transforms (EPG merge, mapping).
- Keep I/O (network, filesystem) inside service modules.
- Use JSDoc for structure hints instead of TypeScript.
- Log context with `{sourceId, channelId}` on errors.
- Use `undici` for fetch, `zlib` for gzipped XML.
- Keep memory bounded: **stream parse** XMLTV, don’t buffer it.

---

## Copilot Tasks

When prompted, Copilot should be able to:

1. Implement `/src/server/services/mapping/resolver.js`
   - Load `config/mapping.yaml`
   - Map `{sourceId, channelId}` → canonical ID
   - Provide reverse lookup
2. Implement `/src/server/services/epg/merge.js`
   - Merge multiple XMLTV inputs with conflict priority
3. Implement `/src/server/services/proxies/stream-proxy.js`
   - Stream upstream content with timeout and header preservation
4. Add Vitest/supertest coverage for routes.

---

## Example Copilot Prompts

- “Generate `src/server/services/mapping/resolver.js` using the rules in this `agents.md`. Include JSDoc typedefs.”
- “Write a Vitest suite for `/lineup.json` that mocks the mapping resolver.”
- “Implement `scripts/ingest-epg.js` to download, merge, and output XMLTV from config.”

---

## Coding Conventions

- Use consistent logging (`log.info`, `log.error`).
- One default export per file, unless utilities.
- ESM imports (`import x from`), not `require()`.
- Avoid large async concurrency — rate-limit fetches.
- Use Composition API for Vue.js components

---

## Deployment Context

**This proxy is designed to run on local/home networks.** Upstream IPTV sources and HDHomeRun tuners are typically on the same LAN and will have private/local IP addresses (e.g., `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`) or local hostnames (e.g., `.local`, `.lan`). Do **not** add code that blocks requests to private or local network addresses — doing so would break the core use case.

---

## Non-Goals

- No TypeScript.
- No UI work (mapping UI comes later).
- No DVR/timeshift features.

---

## Important: Do NOT Run the Admin Build

**Never run `npm run build` or `vite build` inside the `admin/` directory.**

The admin build generates content-hashed asset filenames (e.g. `index-Abc123.js`) and rewrites `public/admin/index.html` with those hashes. This file is tracked in git and must stay pointing to the stable, non-hashed filenames (`index.js`, `index.css`). Running the build will pollute the PR with unrelated asset hash changes.

---

## Important: Keep the MCP Interface in Sync

**Whenever you add or update a server API endpoint, also update `server/mcp.js`.**

The MCP interface (`POST /mcp`) exposes IPTV proxy functionality to AI assistants via the Model Context Protocol. It must stay in sync with the rest of the server:

- **Adding a new route or capability?** Consider whether it should also be exposed as an MCP tool. If so, register it in `server/mcp.js` using `server.tool(...)`.
- **Changing a data shape** (e.g., channel fields, EPG fields, provider config)? Update any affected MCP tools to reflect the new shape.
- **Removing or renaming functionality?** Remove or rename the corresponding MCP tool so the interface doesn't advertise broken capabilities.

The MCP surface is designed for agent use and currently exposes these tools:

| MCP Tool                               | Purpose |
| -------------------------------------- | ------- |
| `get_agent_workflow`                   | Explain the recommended MCP workflow, tool groups, and mutating tool side effects |
| `diagnose_agent_readiness`             | Summarize current provider, channel, guide, and output profile state with issues and recommended next actions |
| `list_providers`                       | List configured source providers |
| `list_channels`                        | List discovered source channels |
| `list_canonical_channels`              | List canonical channels |
| `list_channel_bindings`                | List source-to-canonical bindings |
| `list_guide_bindings`                  | List canonical-to-guide bindings |
| `get_guide`                            | Read guide data for a channel |
| `list_output_profiles`                 | List output lineup profiles |
| `create_output_profile`                | Create a profile |
| `update_output_profile`                | Rename or enable/disable a profile |
| `delete_output_profile`                | Delete a non-default profile |
| `get_output_profile_channels`          | List enabled channels emitted by a profile |
| `list_output_profile_entries`          | List editable per-profile channel settings |
| `set_canonical_channel_published`      | Toggle canonical publish state |
| `set_canonical_channel_preferred_stream` | Choose the preferred stream for a canonical channel |
| `set_canonical_channel_guide_binding`  | Choose the active guide source and EPG channel ID for a canonical channel |
| `update_output_profile_channels`       | Update per-profile ordering, enabled state, and guide number overrides |
| `get_status`                           | Read overall source and refresh status |
| `reload_channels`                      | Rebuild discovered channels from configured sources |
| `reload_epg`                           | Refresh guide data |

Tool results should stay agent-friendly:

- Return `structuredContent` with a stable JSON envelope containing `ok`, `tool`, `summary`, `data`, `sideEffects`, and `nextSuggestedTools`.
- Keep text content aligned with `structuredContent` so non-structured MCP clients still receive useful output.
- Make mutating tool side effects explicit so an agent can reason about follow-up reads and refreshes.

The recommended MCP starting sequence for an agent is:

1. `get_agent_workflow` for operating guidance
2. `diagnose_agent_readiness` for current issues and next steps
3. Targeted read tools (`list_*`, `get_status`, `get_guide`)
4. Mutating tools only after inspection
5. `reload_channels` or `reload_epg` when rebuilds are needed, followed by another diagnostic pass

Each MCP tool also has corresponding integration tests in `test/integration/mcp.test.js` that must be kept up to date.

---

Copilot: treat this file as the authoritative reference for this repository.
