# UX copy audit — 2026-10-23

Scope: text clutter and hierarchy across sign-in, home, account, guides, and admin. Preserve the approved dark sans-serif design and existing service/authentication behavior.

## Findings and changes

- Sign-in surrounded two actions with a promotional column, welcome copy, instructions, an eligibility note, and two configuration warnings. Removed the promotional column and redundant instructions, centered the form, and combined unavailable states when both providers are unavailable. Removed the duplicate sign-in navigation link.
- Home repeated service descriptions in the hero, illustration labels, card paragraphs, status labels, and buttons. Kept one heading, service names, status, primary actions, and setup links. Condensed the help row.
- Account and admin used decorative headings that obscured page purpose. Replaced them with Account and Admin. Existing-email changes and Jellyfin password resets now use expandable controls; initial setup stays open.
- Guides repeated their purpose above self-explanatory selectors and duplicated the Jellyfin address in instructions. Kept a direct title and one copyable address. Removed the out-of-context IPTV rotation troubleshooting step; the rotation confirmation still explains the consequence.
- Footer repeated branding and promotional language. Reduced it to the site name.

Retained: field labels, code-entry instructions, actionable errors, service readiness, password length, private-link warnings, destructive-action confirmations, and the distinction between configuration status and live integration health.

Validation: TypeScript checks, production build, and existing production HTTP test passed. Sign-in/home inspected in the browser; account/admin reviewed in source because live sign-in providers are not configured. This is a focused copy audit, not a complete accessibility or authenticated usability study.
