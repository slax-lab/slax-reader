# Proposal

## Why

Persisting each subscriber's Collection preference leaves it stale when an owner changes a Collection; refreshing every subscriber on each owner change creates write amplification. The maintainer accepted pure pull (N = 0): derive the requesting user's preference from their eligible Collection vectors on demand, without propagating updates to subscribers.

## What Changes

- Compute subscribed-Collection preference during a recommendation request from all of that user's currently eligible subscriptions, using bounded pages and existing native by-ID vector reads. Preserve equal weighting, normalization, publication admission and candidate ranking.
- Do not read, upsert or repair `u:<userId>:collection` on the recommendation path. Keep saved-article preferences and owner Collection maintenance unchanged.
- Preserve missing-input tolerance: use available valid Collection vectors, keep internal eligible/used/missing coverage, and return the existing cold-start response when no usable input exists. Operational failures and invalid vectors remain errors rather than empty success. Never fall back to a stale stored subscription preference.
- Stop subscription-preference Workflow dispatch from subscribe, unsubscribe, delete-subscription and expiry maintenance. Keep subscription business mutations, expiry status maintenance and analytics. Account deletion stops enumerating other subscribers for vector cleanup but still deletes the departing user's own legacy preference record.
- **BREAKING, operator behavior:** the legacy Collection-preference refresh endpoint and already-created user/collection-preference Workflow targets become cleanup-only, never aggregate or write a preference. Retain their dedicated-secret/body validation, response envelope and actual native deletion verification; include `collection_preference_on_demand` as the safe reason.
- Remove the subscription stage from default bulk refresh. An explicit `--kind subscription` fails before database/network access with a clear retirement message. Existing article, article-preference and Collection stages stay unchanged.
- Leave existing article and Collection vectors intact. Old per-user Collection preferences are ignored, not bulk-deleted as a deployment prerequisite. No live cleanup is authorized by this proposal.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `preference-maintenance`: derive subscription preference on read; remove subscription-triggered maintenance and subscriber cleanup fan-out while preserving article maintenance and own-account cleanup.
- `content-recommendation`: use the request-derived subscription preference without changing ranking, exclusions, response shape or the paused article feed.
- `vector-bulk-sync`: retire subscription materialization and define cleanup-only compatibility for the legacy endpoint and old jobs.
- `preference-partial-coverage`: preserve article-refresh tolerance while defining available-input and all-missing behavior for read-time Collection preferences. This capability is introduced by merged `skip-missing-preference-vectors`; archive it before applying this follow-up delta.

## Non-goals

No subscriber push threshold, active-user fan-out, TTL cache, durable subscription ledger, R2 vector copies, outbox, scheduler, online clustering, new database table, embedding generation, public-article feed or UI redesign. Hybrid push/pull is a future option, not dormant machinery to implement now.

## Impact

The vector maintenance read/legacy refresh methods, recommendation service tests, Collection controller dispatches, expiry cron, account-deletion vector cleanup, the existing refresh script/help and their tests. Reuse existing repository eligibility and aggregation helpers; regenerate affected registrations through `pnpm api -- gen:all`. No shared client response contract, dependency, Worker binding or migration change is intended.

The previous local `incremental-collection-publication` work remains untouched. This proposal targets different capabilities and follows that change for delivery rather than mixing uncommitted implementations into one task PR. Archive merged `skip-missing-preference-vectors` first, then the two follow-ups in their documented order; preserve its article-only coverage and incremental guarantees.

## Approval boundary

The maintainer first requested the pure-pull proposal, then confirmed the read-time behavior and explicitly requested implementation on 2026-11-11. After implementation and batching clarification, the maintainer requested PR delivery, authorizing committing and pushing this task branch and opening its PR to `dev`. Production access, merge, deployment and live data deletion remain outside authorization. The change is implemented independently from `origin/dev` in `.local/pull-collection-preferences-worktree` on `feat/pull-collection-preferences`; the preceding uncommitted owner-incrementality work in the primary worktree is preserved and is not included in this PR.
