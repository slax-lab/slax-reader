# Proposal

## Why

Owner Collection events still rebuild history and scan coverage counts even though article contributions can be maintained incrementally. Persisting each subscriber's Collection preference leaves it stale when an owner changes a Collection; refreshing every subscriber on each owner change creates write amplification. The maintainer accepted pure pull (N = 0): derive the requesting user's preference from their eligible Collection vectors on demand, without propagating updates to subscribers.

## What Changes

- Compute subscribed-Collection preference during a recommendation request from all of that user's currently eligible subscriptions, using bounded pages and existing native by-ID vector reads. Preserve equal weighting, normalization, publication admission and candidate ranking.
- Do not read, upsert or repair `u:<userId>:collection` on the recommendation path. Keep saved-article weighting and recommendation ranking unchanged; owner Collection maintenance is included in the combined scope below.
- Preserve missing-input tolerance: use available valid Collection vectors, keep internal eligible/used/missing coverage, and return the existing cold-start response when no usable input exists. Operational failures and invalid vectors remain errors rather than empty success. Never fall back to a stale stored subscription preference.
- Stop subscription-preference Workflow dispatch from subscribe, unsubscribe, delete-subscription and expiry maintenance. Keep subscription business mutations, expiry status maintenance and analytics. Account deletion stops enumerating other subscribers for vector cleanup but still deletes the departing user's own legacy preference record.
- **BREAKING, operator behavior:** the legacy Collection-preference refresh endpoint and already-created user/collection-preference Workflow targets become cleanup-only, never aggregate or write a preference. Retain their dedicated-secret/body validation, response envelope and actual native deletion verification; include `collection_preference_on_demand` as the safe reason.
- Remove the subscription stage from default bulk refresh. An explicit `--kind subscription` fails before database/network access with a clear retirement message. Existing article, article-preference and Collection stages stay unchanged.
- Leave existing article and Collection vectors intact. Old per-user Collection preferences are ignored, not bulk-deleted as a deployment prerequisite. No live cleanup is authorized by this proposal.
- Include the approved owner-side implementation in this same PR: explicit-share and inherited-share aggregates, transactionally maintained coverage counters, indexed missing-member lookup and publish-only Collection events. Sharing/default/Collection toggles do not reread all articles or recluster once state is initialized.
- Upgrade existing per-user DO state to the share-group layout on first use by rebuilding once from existing vectors; no article re-embedding or bulk vector deletion. Explicit refresh, missing state, changed mean version and unresolved old contributions retain rebuild paths. Keep the existing publication-time MAX query.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `preference-incremental-maintenance`: fold the local owner-only requirements into this combined change, preserving strict Collection dependency handling.
- `preference-maintenance`: derive subscription preference on read; remove subscription-triggered maintenance and subscriber cleanup fan-out while preserving article maintenance and own-account cleanup.
- `content-recommendation`: use the request-derived subscription preference without changing ranking, exclusions, response shape or the paused article feed.
- `vector-bulk-sync`: retire subscription materialization and define cleanup-only compatibility for the legacy endpoint and old jobs.
- `preference-partial-coverage`: preserve article-refresh tolerance while defining available-input and all-missing behavior for read-time Collection preferences. This capability is introduced by merged `skip-missing-preference-vectors`; archive it before applying this follow-up delta.

## Non-goals

No subscriber push threshold, active-user fan-out, TTL cache, durable subscription ledger, R2 vector copies, outbox, scheduler, online clustering, new PostgreSQL/subscriber-state table, embedding generation, public-article feed or UI redesign. Hybrid push/pull is a future option, not dormant machinery to implement now.

## Impact

The vector maintenance read/legacy refresh and owner publication methods, sharing-group repository queries, per-user SQLite state/store and publish RPC, Workflow branches, recommendation tests, Collection controller dispatches, expiry cron, account-deletion cleanup, the refresh script/help and their tests. Reuse existing repository eligibility and aggregation helpers; regenerate affected registrations through `pnpm api -- gen:all`. No shared client response contract, dependency, Worker binding or external database migration changes. Owner DO state uses a versioned SQLite layout and a new publish RPC; Core must deploy before Edge.

The maintainer explicitly approved combining owner incrementality and subscriber pull into PR #566 on 2026-11-11. This change now owns both scopes; the old local owner-only planning files are historical work, not a second deliverable. Archive merged `skip-missing-preference-vectors` before this combined follow-up. Preserve the source worktree as an integration reference.

## Approval boundary

The maintainer first requested the pure-pull proposal, then confirmed the read-time behavior and explicitly requested implementation on 2026-11-11. After implementation and batching clarification, the maintainer requested PR delivery, authorizing committing and pushing this task branch and opening its PR to `dev`. Production access, merge, deployment and live data deletion remain outside authorization. The change is implemented independently from `origin/dev` in `.local/pull-collection-preferences-worktree` on `feat/pull-collection-preferences`; the preceding owner-incrementality work is now included at the maintainer's explicit direction. The original worktree remains a reference. This approval authorizes updating #566, not merging it into dev or deploying.
