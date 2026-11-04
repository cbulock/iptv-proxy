# Friendly IPTV phrase URLs

## Intent and selected approach

Users need personal IPTV playlist and guide URLs they can enter with a TV remote or copy to a phone. The user selected randomly generated word phrases over compact character codes on October 25, 2026. This document proposes the remaining implementation details for approval.

## Approaches

- Selected: a stable, randomly generated three-word phrase shared by two short routes. Words are easier to read and enter without mixed case or ambiguous characters.
- Considered: a ten-character random code. It takes fewer characters but the user preferred a phrase.
- Considered: shortening only the route while retaining the existing 43-character token. This preserves credential strength but leaves most of the typing burden.

## User-visible behavior

Example URLs (illustrations only, never actual credentials):

- Playlist: `https://iptv.bulock.house/p/maple-otter-sunset`
- Guide: `https://iptv.bulock.house/g/maple-otter-sunset`

Account > Live TV > Show app links displays the phrase URLs using the existing copy buttons. The playlist and guide share the same lowercase, hyphen-separated phrase. Setup instructions explain that only `/p/` changes to `/g/`. Phrases are generated automatically; usernames, email addresses, and user-selected phrases are not used.

Showing links repeatedly preserves the phrase. Issuing the first phrase preserves existing long credentials, apps, and viewer sessions. Existing long URLs continue working. Replace links replaces the phrase and native credential together and retains the existing warning and viewer-session invalidation. Revocation and backup-restore invalidation erase both credentials; disabled accounts cannot resolve aliases. Admin restoration generates fresh credentials.

## Routing and storage

Add an additive SQLite migration storing a unique keyed phrase hash and encrypted phrase associated with the user's current native credential. Generate each word independently with cryptographic randomness from a checked-in, documented list containing at least 4,096 distinct lowercase words; retry collisions transactionally. Prefer familiar words and exclude punctuation, digits, and offensive terms. Word-list provenance and its actual strength must be checked during implementation.

Add an authenticated internal alias-resolution operation. The gateway handles exactly `/p/<phrase>` and `/g/<phrase>`, resolves the phrase internally, and serves the existing protected playlist or guide directly without a public redirect. It reuses native-token rewriting and stream authorization. Never expose an arbitrary upstream path through an alias, log phrases, or send them to an external shortening service. Preserve GET/HEAD behavior, content types, no-store headers, and current authorization failure handling. Existing configurable IPTV URLs remain the source for public link construction.

## Guessing protection

Three words provide less randomness than the existing native token, so enforce a shared, database-backed ceiling of 60 alias-resolution attempts per minute before any phrase lookup. Count successful and unsuccessful attempts and apply the ceiling across gateway processes/restarts; this prevents bypass by distributing requests across addresses. Return 429 with Retry-After when exhausted, and retain no-store headers. Existing native-token and viewer-session requests do not consume this budget. A flood may temporarily prevent new playlist/guide alias requests; established streams continue using native authorization. Do not lengthen phrases or silently weaken this protection if implementation reveals a constraint; surface the constraint for a decision.

## Scope and validation

This is a local portal/gateway change using the current Nuxt, Node, and SQLite stack. No DNS changes, external shortener, QR-code feature, deployment, or live credential rotation is included. Preserve the pre-existing gateway launch fix and its untracked test.

Verify stable issuance and collision handling; preservation of existing credentials; rotation, revocation, disablement, restore and admin restoration; shared limiter exhaustion/reset/persistence; actual HTTP playlist/guide behavior and authorization; protected rewritten playback URLs; malformed paths and upstream errors. Run the relevant core and HTTP integration tests, type checks, and production build before declaring implementation complete.
