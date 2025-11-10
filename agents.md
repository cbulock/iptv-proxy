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
| Route | Description |
|--------|--------------|
| `/discover.json` | HDHomeRun discover format |
| `/lineup.json` | HDHomeRun lineup format |
| `/stream/:channelId` | Proxy upstream stream |
| `/images/*` | Proxy channel logos |

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

## Non-Goals
- No TypeScript.  
- No UI work (mapping UI comes later).  
- No DVR/timeshift features.

---

Copilot: treat this file as the authoritative reference for this repository.
