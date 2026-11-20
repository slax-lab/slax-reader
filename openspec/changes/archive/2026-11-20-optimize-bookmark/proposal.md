# Proposal

## Why

`apps/web/app/plugins/powersync.client.ts` is a serial async Nuxt plugin. Every top-level document except the anonymous public bypass waits for local database initialization, data-version migration, and account ownership checks before the Vue application mounts. In a Chrome 158 run against a production-profile build, while another tab held the shared database lease, a signed-in `/bookmarks` document loaded at 393 ms but mounted at 8,470 ms, 25 ms after the 8 s PowerSync timeout. Until then nothing hydrates: links, highlight tools, panels, and the theme switcher do not respond.

Several reader surfaces do not need the local database to show or operate their content. The snapshot detail page `/b/[id]` already loads metadata and body from `/api/content/[uuid]` and server-renders them. Only an owned bookmark switches marks, title, and reading position to local data, and the owner path already works through REST. `/user` and `/collection/manage` load their content from REST and use the local database only for optional decorations (a non-production sync indicator, notifications, the lab RSS presence gate).

## Requested scope and approval

On 2026-11-19 the requester asked that, when startup lands on an article, its data be loaded by request immediately and PowerSync be awaited afterwards, so slow local startup cannot break the page. The requester also asked for a partly client-rendered detail page; after discussion the requester chose to implement only the first request, and asked that permission checks be handled carefully and that other pages that can use the same fallback be identified.

## What Changes

- Documents first opened on a **deferrable route** mount without waiting for local startup. The PowerSync plugin starts the existing startup sequence in the background and exposes its readiness. The deferrable routes are `/b/[id]`, `/user`, and `/collection/manage`.
- On those documents every local-data consumer behaves exactly as it does when local mode is unavailable today, and takes its existing REST or no-op branch. Nothing reads the database before the existing data-version migration and account ownership checks pass.
- `/b/[id]` upgrades in place: when deferred startup completes its checks and the current account owns the bookmark, the page switches marks, title, and reading position to local data, as it does today after `local.exists(uuid)`, without reloading the article body. Visitors and other accounts never wait for or switch to local data.
- Leaving a deferred document for a non-deferrable route (Inbox `/`, `/bookmarks`) waits for local startup, then performs a full document load of the destination so the destination starts with its normal local-first guarantees. If local startup is unavailable, the same document load gives the destination its own normal startup and REST fallback.
- Every other route, the anonymous public bypass, and the extension bridge keep their existing startup.

## Route classification

| Route | Local data use today | This change |
| --- | --- | --- |
| `/b/[id]` | Owner bookmark: marks, title, reading position, local mark writes | Deferred, upgrades in place for the owner |
| `/user` | Sync indicator (non-production), notification feed | Deferred, REST notifications |
| `/collection/manage` | None beyond shared components | Deferred |
| `/`, `/bookmarks` | List, tags, collections, RSS, newsletter, first-sync, onboarding readiness | Unchanged blocking startup (onboarding readiness requires local ownership and first-sync proof) |
| `/x/ext-bridge` | Local reads and writes for the Extension | Unchanged |
| `/login`, `/guide`, anonymous `/` | None (public bypass) | Unchanged |
| `/s/[id]`, `/c/...`, docs, `/auth`, `/onboarding`, dashboard, others | None | Unchanged blocking startup; deferral can be added later by route list once verified |

## Permission and data-safety rules

- Readiness is published only after the existing sequence finishes on that document: recovery, `ensureDataVersion` (version-bump clearing), and `guardAccount` (account-switch clearing and `powersync-owner` assignment). A failed check leaves the document on REST, as today.
- The detail upgrade additionally requires `metadata.role === 'owner'` from the current authorized `/api/content` response, the local row to exist, the current token's account to equal `powersync-owner`, and the account generation to be unchanged between the request and the switch.
- Snapshot session recovery keeps precedence: a document in rejected-session recovery does not start local startup, as today.
- Logout and account changes while deferred use the existing lifecycle: the cookie watcher and router reconciliation run after readiness, and a token change before readiness is handled by `guardAccount` at the end of startup.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-local-sync`: deferrable reader routes start the local database without blocking application mount, and the snapshot detail page upgrades to local data after readiness.

## Impact

- `apps/web/app/plugins/powersync.client.ts`, a route policy module next to `public-startup-policy.ts`, `apps/web/app/pages/b/[id].vue`, and unit tests.
- No change to SSR, edge caching, `/api/content`, the SDK, the VFS, database identity, data version, or the Inbox.
- The hosted Extension bridge keeps its existing startup.

## Non-goals

Client-rendering the article body, deferring Inbox startup, changing recovery or timeouts, changing SSR caching, and making shared local-first components reactive to late readiness.
