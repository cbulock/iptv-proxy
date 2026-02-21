# Copilot Instructions for Code Reviews – IPTV Proxy

These guidelines are intended to help AI tools like GitHub Copilot provide relevant and useful code review suggestions for the IPTV Proxy project.

## 1. Project Overview

This project merges IPTV sources (M3U and EPG/XMLTV) into a single unified output. It includes:

- Parsing multiple M3U playlists and applying channel mapping
- Merging multiple XMLTV EPGs (including support for OTA tuners like HDHomeRun)
- Outputting compatible files for clients (e.g., Plex, Jellyfin, etc.)
- Optional image proxying and dynamic playlist/EPG generation via HTTP

## 2. Code Style

- Follow standard JavaScript (ESM) style with top-level `import`/`export`
- Prefer `const` and `let`; never use `var`
- Use consistent indentation (2 spaces)
- Use single quotes `'` for strings unless escaping would make it harder to read
- Avoid abbreviations in variable names unless obvious (e.g., `EPG`, `M3U`)
- Use descriptive names like `guideNumber`, `tvg_id`, `channelMap`, etc.

## 3. Project Structure

- `config/` contains YAML files (`m3u.yaml`, `channel-map.yaml`, etc.)
- `scripts/` contains import and generation logic
- `data/` contains generated output (e.g., `channels.json`, `xmltv.xml`)
- `server/` or root contains HTTP-serving logic

✅ Copilot should:
- Ensure config files are loaded in a fail-safe way with clear error messages
- Help maintain consistent structure in output files (`EXTINF`, channel names, `tvg-*` attributes, etc.)

❌ Copilot should avoid:
- Over-engineering small scripts with unnecessary classes
- Adding frontend-related suggestions unless prompted

## 4. Best Practices

- Keep functions small and focused (e.g., `parseM3U`, `applyMapping`, `mergeEPG`)
- Avoid inline complex logic; extract helpers instead
- Prefer `async/await` and avoid raw `.then()` chains
- Use `fs/promises` over `fs` when working asynchronously
- Use `yaml` and `fast-xml-parser` consistently with existing settings

## 5. Channel and EPG Handling

- When parsing M3U:
  - Normalize `tvg-id`, `tvg-logo`, and `group-title`
  - Match and map channels via both name and `tvg_id`
- When parsing XMLTV:
  - Preserve all `<channel>` and `<programme>` tags unless filtered
  - Match `channel id="..."` with `tvg-id` or guide number

Copilot should help identify:
- Missing mappings
- Potential channel duplication
- Mismatched or malformed tags in the output XML

## 6. Server Behavior

- The server exposes playlist and EPG via `/m3u` and `/xmltv` endpoints
- It should support reverse proxy setups (`X-Forwarded-*` headers) for base URL generation
- Use Express best practices: error handling middleware, avoid global state

## 7. Tests and Validation

- If test scripts are added:
  - Validate M3U output formatting
  - Validate XMLTV is well-formed and parsable
- For now, manual validation is common — Copilot should suggest scriptable checks where useful

## 8. Comments and Docs

- Add comments for non-obvious logic (e.g., fallback mapping rules, EPG merging)
- No need for JSDoc unless doing complex logic
- Keep README and config samples up to date

## 9. Ignore Suggestions For

- Frontend/UI libraries (React, Vue, etc.)
- TypeScript conversion (this is a plain JS project for now)
- Linting/Prettier unless project adds config for it

## 10. Tone of Suggestions

- Be constructive and focused on clarity and maintainability
- Suggest refactoring when logic is too nested or repetitive
- Encourage consistent naming and output formats

---