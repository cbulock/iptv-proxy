# Bulock Media Implementation Plan

Goal: Implement the approved portal, access enforcement integrations, and local verification without publishing or sending real invitations.
Architecture: Nuxt TypeScript UI/API, Node SQLite single-instance storage, durable jobs, authenticated IPTV entitlement contract.
Spec: User-approved plan in this chat, reproduced by the behavior and acceptance criteria below.

Global constraints: media.bulock.house; sender media@bulock.com; dark sans-serif; no membership wording in UI; no automatic identity merging; no live mutations.

## Tasks
- [ ] 1. Storage/auth: server/core/{db,crypto,auth}.ts, tests/auth.test.ts. Prove atomic single-use challenges, resend, lockout, invitations, explicit identity linkage and disable. Implement then run node --test tests/auth.test.ts.
- [ ] 2. Integrations: server/core/{plex,jellyfin,iptv,jobs}.ts, tests/services.test.ts. Prove restricted mapping, retryable provisioning, grant/revoke and handoff contracts before implementation.
- [ ] 3. HTTP: server/api/[...path].ts, server/utils/runtime.ts. Schema validate input, same-origin mutation guard, session/admin/recent-auth checks, no secret error output. Exercise real HTTP boundaries.
- [ ] 4. UI: app/{app.vue,assets/main.css,pages/*}. Build responsive login, dashboard, guides, account and admin with loading/error/empty states. Verify running app in browser.
- [ ] 5. IPTV adapters: integrations/iptv/*.mjs with protocol tests, apply safe integration changes to available existing projects. Public endpoint coverage and private tuner separation are deployment gates.
- [ ] 6. Operations: Dockerfile, compose.yaml, .env.example, README, restore invalidation. Build, run full tests, review and fix important findings.

Review focus: email scanner consumption; concurrent provisioning with lost remote response; ambiguous restriction mappings; HLS/redirect bypass; restored credentials reviving access. Each gets a behavioral test or explicit production gate.

No commits or publishing are part of this execution.
