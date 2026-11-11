# Validation

## Approval, location and scope

On 2026-11-11 the maintainer confirmed the request-time Collection-vector aggregation behavior and explicitly requested implementation, then requested a pull request after reviewing the batching behavior. The deliverable is on `feat/pull-collection-preferences`, based on `origin/dev` at `6016ee48`, in `.local/pull-collection-preferences-worktree`. The PR request authorizes committing and pushing this task branch and opening a PR to `dev`, not merging or deploying it. The primary worktree's previous `incremental-collection-publication` source changes remain untouched. No production connection, deployment, migration or live vector cleanup was performed.

The independent change touches six production files: the vector service read/retirement paths, account-deletion vector dispatch, the Collection controller, the expiry cron, the user-preference Workflow step name and the operator refresh script. Recommendation ranking, public response contracts, source eligibility SQL, owner aggregation, article preferences, native indexes and bindings are unchanged.

## Implemented behavior

- `readUser(id, 'collection')` computes from the current eligible subscriptions through a read-only `readCollectionPreference` helper. It uses the existing normalized unit-weight aggregate, carries internal coverage and never reads the legacy user Collection-preference key.
- Reads reuse keyset pages of 100 and native get batches of 20 with at most four concurrent calls. Every eligible page is visited; missing vectors are skipped but invalid data or transport errors are not. Empty/all-missing input produces the existing cold-start result with no maintenance or fabricated vector.
- Subscription mutations and expiry-status maintenance no longer create vector-maintenance jobs. Account deletion still cleans its own article/Collection/preference records but no longer enumerates other subscribers for preference work; ordinary subscription relation deletion remains.
- The old Collection-preference refresh and old Workflow payloads retire only the exact legacy key, with the explicit retirement reason and normal native deletion verification. Absent keys cause no mutation. Retirement uses new Workflow step names so cached materialization outputs cannot bypass cleanup.
- Default bulk refresh has three stages. Explicit `--kind subscription` fails before creating a database connection or sending a request. Existing production vectors do not need deletion or rebuilding for this switch.

## Automated checks

Commands ran from the independent worktree using the standard root API launcher.

- Installed existing locked dependencies with `pnpm install --frozen-lockfile --offline --filter slax-reader-backend...`. A first attempt with whole-directory node_modules symlinks was rejected by pnpm's path-safety check; those session-created links were removed and installation succeeded normally. No manifest or lockfile changed.
- `pnpm api -- gen:all`: passed with `SLAX_API_CONFIG=deploy/cloudflare/api.toml.example` and nonconnecting local placeholder database URLs for Prisma generation. No database migration ran. Generated tracked files have no diff.
- `pnpm api -- typecheck`: passed, including contracts.
- `pnpm api -- lint`: zero errors, 345 warnings. There is one new unused-context warning on the cron callback parameter; the generated cron contract still passes a ContextManager. No lint errors are suppressed.
- `pnpm api -- test --reporter=dot`: **3,881 passed, 118 skipped, zero failed**; 245 files passed and 15 skipped. The skipped environment-dependent tests are not claimed exercised. The related vector/preference and runtime tests ran.
- `openspec validate --all --strict`: **124 passed, zero failed** in this worktree. The primary worktree includes the separate uncommitted owner-incrementality change and therefore has a different total. The known archive prerequisite remains: archive merged `skip-missing-preference-vectors` before this delta modifies `preference-partial-coverage`.
- `pnpm api -- build --config deploy/cloudflare/api.toml.example`, with `SLAX_API_GENERATED_DIR` pointing at a dedicated temporary build directory: Core, Edge, AI and Browser dry-run builds passed. Outputs were removed after verification.
- `git diff --check`: passed.

## Real local runtime evidence

`test/utils/vectorTaskAuth.runtime.test.ts` runs actual Workerd via the installed Miniflare, bundles the real Edge/Core entries, and sends HTTP requests through authentication middleware, generated routing, Controllers, the real recommendation orchestrator, recommendation service and vector service. PostgreSQL, Vectorize and subscription mutation persistence are fixture boundaries; their SQL behavior is exercised separately below. Test-only fixture controls are not imported by production entries.

The scenario passed:

1. A signed-in user with one subscribed Collection and an intentionally stale legacy user preference receives candidate 301, matching the current Collection direction rather than the stale direction.
2. Changing the source vector before a second HTTP request changes the winner to candidate 302 without subscription actions or a maintenance job.
3. No input vector produces `cold_start` even while the stale legacy profile exists.
4. HTTP subscribe/unsubscribe/delete-subscribe requests change the next recommendation read; deleting the last subscription yields cold start. The actual Controllers run; persistence is the explicit in-memory fixture.
5. A forged `user_id` query is rejected before subscription reads, and an unsigned request is denied. The recorded subscription reader IDs all belong to authenticated user 7.
6. During recommendation/subscription scenarios, counters show **zero vector upserts, zero vector deletes and zero embeddings**. Vector reads use only Collection IDs; the legacy user key remains untouched. Existing analytics retain their normal code path.
7. Through both direct Core and Edge-forwarded HTTP, a Reader JWT cannot authorize legacy task cleanup; the dedicated task secret can. Cleanup deletes exactly the legacy key and performs no subscription/source read or upsert. The second cleanup sees absence and makes no second delete.

## SQL, numerical and compatibility coverage

- `collectionPreferenceRead.test.ts`: sizes 0, 1, 20, 21, 100 and 205; independent normalized equal-weight oracle; exact coverage; full pagination; at-most-20 gets and at-most-four concurrency; a missing first page with later valid data; all-missing vs empty; replacement visible between reads; malformed dimensions, NaNs and zero vectors; an error after a valid page; unchanged exact article-profile reads. Legacy cleanup tests cover exact-key isolation, absent-key no-op, not-yet-visible deletion and failed deletion.
- `contentRecommendation.test.ts`: actual PGlite `VectorMaintenanceRepo` eligibility SQL and actual recommendation service verify subscribe/delete/expiry, inactive or deleted subscription, closed Collection, deleted owner/subscriber, owner sharing revocation, own Collection exclusion and renewal cancellation that retains entitlement. Replacing the subscribed Collection direction changes the recommendation result without refreshing the user. MMR, own/subscribed exclusions and the paused article feed retain existing tests.
- Existing service and multidirection contracts were migrated from write assertions to read assertions rather than removing their mathematical cases. Article weighting, independent preferences, partial inputs, 103-subscription pagination, repeated reads and re-subscription remain covered.
- Handler/cron tests retain successful business mutations and expiry SQL while requiring zero vector dispatch, including 2,105 changed subscriptions. Account-deletion and diagnostic-cleanup tests require no subscriber enumeration and retain cleanup of the departing user's own legacy key before destructive business cleanup.
- A Workflow replay fixture preloads old `collection-preference-write/visible` results and confirms the new retirement write/visible steps still execute. Existing task gate, namespace and route tests continue to pass.
- Script tests retain parameterized scopes, sequential calls, dry-run and truthful failure/pending reporting; retired-stage cases assert no database client or HTTP access.

## Local cost observation

A one-off Node/tsx call exercised the actual service with synthetic 1024-dimensional vectors and in-memory repositories. No production data or network was used. Results are observations, not a production benchmark or latency guarantee.

| Eligible subscriptions | SQL pages | Native get batches | Peak get concurrency | Local milliseconds |
| --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 0 | 0.090 |
| 1 | 1 | 1 | 1 | 0.778 |
| 20 | 1 | 1 | 1 | 2.017 |
| 21 | 1 | 2 | 2 | 1.264 |
| 100 | 2 | 5 | 4 | 3.534 |
| 205 | 3 | 11 | 4 | 7.122 |

A full 100-row page needs a subsequent empty SQL page to prove completion. Cost remains O(subscriptions * dimensions), not O(1), and excludes network, production SQL eligibility checks and candidate retrieval.

## Review and remaining boundaries

- **Bugs:** equal weighting and complete pagination reuse existing logic; old materialized profiles cannot influence reads; no-vector results do not fabricate personalization; errors remain errors. New retirement steps avoid cached materialization outputs. Idempotent cleanup does not remove article or owner Collection vectors.
- **Security:** authenticated identity and current eligibility determine source IDs. No new destination, dependency, secret, route or binding is added to production. The old cleanup route retains its dedicated task-secret and strict body/path checks. Fixture controls live only in test worker files. No vectors or user content are added to production logs.
- **Compliance:** implementation matches the approved pure-pull change. Normal reads have no maintenance writes; account deletion and explicit legacy cleanup retain their narrowly scoped exception. Proposal, specs, tasks and this record distinguish old data, local verification and live operations. No Important code finding remains open.
- Production PostgreSQL/Hyperdrive cache visibility, Vectorize asynchronous propagation, live latency and rollout of resumed Cloudflare Workflows were not exercised. The local Workflow replay is not a remote deployment test. Newly published owner vectors must still become visible before they affect a read.
- `git apply --check` of this production-source diff against the preceding local owner-incrementality implementation succeeded without modifying that worktree. The combined implementation has not been runtime-tested together; perform integration verification when sequencing the two changes for delivery.
- No frontend/CLI/Extension/Mobile source, package, dependency, build output or shared client contract changed; no client package version bump was made. No PR was opened. Any applicable human hands-on acceptance and delivery review remain prerequisites before a future PR.

## PR delivery review

The maintainer requested PR delivery after implementation and the batching clarification. The pre-push Bugs, Security and Compliance pass was repeated against the unchanged production diff and the complete planning/test evidence: no Important finding remains. The unused cron-context lint warning is a Nit and remains disclosed above. `origin/dev` is still `6016ee48`, so no base update or code change invalidates the previously recorded build, full-suite or runtime evidence.

This PR has no frontend surface, interaction, accessibility, visual-layout or client-contract edit; it changes backend preference freshness with the same ranking formula and response shape. No CLI/Extension/Mobile package output is affected, and no version increment is required. Remote latency/visibility and combined-runtime verification with the separate uncommitted owner-incrementality change remain explicit gaps. This is an independent task PR; neither merge nor deployment is authorized.
