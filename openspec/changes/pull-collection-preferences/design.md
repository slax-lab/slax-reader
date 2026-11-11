# Design

## Context

See `proposal.md` for motivation. The inspected tree is `feat/incremental-collection-publication`, based on `6016ee48`, with the preceding local change still uncommitted. Its implementation is not part of this proposal.

`ContentRecommendationService.collections` obtains its preference through `VectorMaintenanceService.readUser(userId, 'collection')`. That method currently reads `u:<id>:collection` from the user index. The existing `aggregateCollections` already pages `VectorMaintenanceRepo.listUserCollections`, obtains `c:<id>` values, normalizes each contribution with `addVector`, and normalizes the final float64 sum. The materialization branch of `refreshUser` is the only reason this calculation writes a user-index record.

The query excludes deleted users/owners, own Collections, deleted/inactive/expired subscriptions, closed/unpublished Collections and Collections with no eligible published member. It does not equate `is_cancelled` alone with loss of entitlement. The unsubscribe action actually deletes its subscription relation. Preserve these rules rather than inventing new cancellation semantics.

## Goals / Non-Goals

**Goals:** remove subscriber write amplification and stored-profile staleness; reuse the existing aggregate math and eligibility; make work proportional to the requesting user's subscriptions, never a Collection's subscribers or the user's article history; preserve operator and account-deletion safety during transition.

**Non-goals:** global hybrid thresholds, shared-view optimization, precomputed subscriber sums, subscriber DO state, background refresh, caching infrastructure, source-event guarantees, changes to owner Collection incrementality or interest clusters. The requested pure-pull default does not justify an empty precomputed layer or configuration knob for hypothetical future push.

## Decisions

### 1. Reuse the existing calculation behind the read interface

Keep the existing `readUser(id, preference)` call boundary so consumers do not need a new API. Its article branch retains the exact private user-index read. Its Collection branch runs a read-only helper returning `{ vector: number[] | null, coverage: { eligible, used, missing } }`, backed by `aggregateCollections`, and returns the vector to the existing recommendation service. The helper's coverage stays testable without adding client fields or logging vectors/IDs.

Keep raw Collection vectors, one unit-weight normalized contribution per eligible Collection ID, and final normalization. Do not average already-normalized subset averages: a future mixed design would need raw sums and contribution bookkeeping. Current missing-source behavior remains explicit: absent values are skipped; an entirely missing page does not stop later pages; invalid vectors and transport failures throw. If there are no usable values, return `null` and let the existing consumer emit `cold_start` without ANN. Do not reuse a stale `u:<id>:collection` record even when it exists. A zero resultant sum is unavailable/error under the existing normalization contract, not a fabricated vector.

### 2. Bound batches, not the population included

Reuse SQL keyset pages of 100, native get batches of 20 and at most four concurrent batches per page. Consume each page into the running sum, then release its vectors. No latest-N sampling or subscription cap is introduced. More than 100 subscriptions require additional SQL pages; the total vector-fetch count is approximately `ceil(S / 20)` and arithmetic is O(S * D), where S is eligible subscription count and D is dimension. This is not O(1) total work. The existing SQL also checks source publication eligibility with `EXISTS`; that database work is not claimed to vanish.

The previous assertion that this is always one PG query was too strong: it is page-dependent and separate candidate-admission queries still run. Old sync counts are not a current census and will not be used to justify a production latency promise. Test 0, 1, 20, 21, 100 and 205 subscriptions for call counts; measure local latency without treating fixture timings as a production benchmark.

### 3. No recommendation-time vector maintenance

The request may perform the existing recommendation analytics, but must not dispatch maintenance, write/delete vector records, call embeddings or touch preference DO state. Remove only the vector-dispatch calls from Collection subscribe/unsubscribe/delete handlers and the expiry cron. Keep business mutations, the expiry-status job and event analytics intact.

Account deletion retains article/owner Collection cleanup and the departing user's own legacy `u:<id>:collection` cleanup. Remove only the loop that enumerates the owner's subscribers to refresh their preferences; the normal business deletion of subscription relations is unaffected.

### 4. Legacy refresh becomes cleanup-only

Keep `/v1/collection/preference/refresh`, its fixed-secret gate, canonical-path/body checks and ordinary `VectorRefreshResult` envelope. The `refreshUser(id, 'collection')` branch stops enumerating subscriptions and deletes only that user's legacy key, reporting `collection_preference_on_demand`. It must never report `written` or synthetic input coverage. If the key is already absent, return `empty` without a mutation; otherwise delete, preserve the receipt/removed ID, and verify absence as usual. Failures and pending deletion remain failures/pending, not successful initialization.

Already-created user/Collection-preference Workflow payloads remain recognized and use cleanup-only behavior. Use a newly named retirement step for this branch so a previously persisted materialization step result is not mistaken for a new cleanup result. These compatibility operations are not emitted by normal subscription events anymore; explicit cleanup and account deletion remain possible.

The repository script defaults to article -> article-preference -> collection. Reject explicit `--kind subscription` before creating the database client or sending requests, with `subscription_preference_on_demand` and an explanatory help entry. Do not rewrite gitignored historical ledgers or runners. Operators still using old callers must be warned that the retained endpoint now removes an obsolete record rather than warming a preference.

### 5. Freshness means current observed sources, not a distributed snapshot

A request uses the eligible subscriptions returned by its database queries and the Collection vectors currently visible to native reads. It removes the extra stale subscriber materialization, but cannot make the owner's asynchronous publication or Vectorize visibility instantaneous. Different source revisions may be observed across pages; no cross-store snapshot is claimed. Database connection/result-cache configuration is not changed by this proposal, so production acceptance must verify its real visibility behavior rather than assume it from local fixtures. Candidate publication/permission admission remains authoritative and unchanged. Permission changes during a request have the existing request-consistency boundary; stale index metadata never grants access to content.

### 6. Keep future hybrid work separate

Pure pull (N = 0) avoids all subscriber-vector fan-out. A future push portion is justified only by measured read frequency, subscription cardinality and latency/cost budgets. It would need raw unnormalized sums, per-source applied versions, retirement/removal handling and threshold transitions. The current owner write only exposes the immediately previous visible vector; that is not proof every subscriber has applied that same version. Do not claim exact incremental subscriber updates from that handoff alone. No such machinery ships now.

## Risks / Trade-offs

- [Added request latency proportional to subscriptions] -> reuse bounded batches, exercise multi-page cases and measure call counts. No production latency claim or silent truncation.
- [Missing or not-yet-visible source vectors] -> available-input coverage; no stale stored-profile fallback, no repair calls, honest cold start when all are unavailable. Owner publication failures still require their existing repair path.
- [Old workers/jobs can still materialize during rollout] -> new readers ignore those records. Deploy the new Core behavior before stopping Edge dispatch and updating the caller; do not require bulk cleanup for correctness.
- [Operator behavior changes] -> document the cleanup-only endpoint and explicit retired-stage error. Keep authentication and native deletion verification.
- [Rollback uses obsolete materialized preferences] -> roll back all consumers/producers together and rerun the previous version's explicit subscription refresh with separately authorized operations. Retaining old records is not evidence they are current.

## Migration and delivery

1. Preserve the existing uncommitted owner-incrementality work. Following the maintainer's implementation approval, implement pure pull independently on `feat/pull-collection-preferences` from `origin/dev` in `.local/pull-collection-preferences-worktree`; its source changes do not depend on the owner-state layout. Keep delivery sequenced after the preceding task, with separate review, rather than copying that uncommitted implementation into this branch. A successful `git apply --check` is integration compatibility evidence only, not combined-runtime verification.
2. Keep the user-index schema/namespace and all article/Collection vectors. No PostgreSQL, D1, R2 or DO migration is required for pure pull. Regenerate registration outputs, do not hand-edit them.
3. Run the specified local checks and real local Worker HTTP scenarios. Record production-source visibility and latency as unverified unless separately authorized and exercised.
4. Archive `skip-missing-preference-vectors` before this delta's `preference-partial-coverage` modifications. Keep the preceding owner-incrementality change's separate capability and validation.
5. Do not deploy, mass-delete legacy vectors, touch production credentials or restart the old production tunnel as part of planning or local testing.
