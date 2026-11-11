# Validation

The current delivery combines owner-side incremental publication and subscriber pull in PR #566. The **Combined integration verification** section records current acceptance; earlier sections describe the already-reviewed subscriber-only revisions and are retained as history.

## Approval, location and scope

On 2026-11-11 the maintainer confirmed the request-time Collection-vector aggregation behavior and explicitly requested implementation, then requested a pull request after reviewing the batching behavior. The deliverable is on `feat/pull-collection-preferences`, based on `origin/dev` at `6016ee48`, in `.local/pull-collection-preferences-worktree`. The PR request authorizes committing and pushing this task branch and opening a PR to `dev`, not merging or deploying it. The primary worktree's previous `incremental-collection-publication` source changes remain untouched. No production connection, deployment, migration or live vector cleanup was performed.

The original subscriber-only revision touched six production files: the vector service read/retirement paths, account-deletion vector dispatch, the Collection controller, the expiry cron, the user-preference Workflow step name and the operator refresh script. That revision left recommendation ranking, public responses, source eligibility SQL, owner aggregation, article preferences, native indexes and bindings unchanged. The combined revision below additionally changes owner aggregation state and publication while preserving their mathematical and permission semantics.

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
- `git apply --check` of this production-source diff against the preceding local owner-incrementality implementation succeeded without modifying that worktree. At that review stage the implementations had not been runtime-tested together; the combined verification below now supersedes that gap.
- No frontend/CLI/Extension/Mobile source, package, dependency, build output or shared client contract changed; no client package version bump was made. PR #566 is open against `dev`; no merge or deployment has occurred. The backend-only scope and completed pre-push review are recorded below.

## PR delivery review

The maintainer requested PR delivery after implementation and the batching clarification. The pre-push Bugs, Security and Compliance pass was repeated against the unchanged production diff and the complete planning/test evidence: no Important finding remains. The unused cron-context lint warning is a Nit and remains disclosed above. `origin/dev` is still `6016ee48`, so no base update or code change invalidates the previously recorded build, full-suite or runtime evidence.

This PR has no frontend surface, interaction, accessibility, visual-layout or client-contract edit; it changes backend preference freshness with the same ranking formula and response shape. No CLI/Extension/Mobile package output is affected, and no version increment is required. Remote latency/visibility and combined-runtime verification with the separate uncommitted owner-incrementality change remain explicit gaps. This is an independent task PR; neither merge nor deployment is authorized.

## Automated review follow-up

PR #566's first remote checks passed, including API CI, config drift and automated review, for `3ce75f14`. The automated Bugs/Security/Compliance review reported no Important findings and five Nits. Four are addressed: reconcile the stale pre-PR statement, require the exact expected get concurrency (including four for 100/205 sources), group the account-cleanup test with its existing describe, and remove the extra blank line before the recommendation-read tests.

The suggestion to drop the cron callback parameter was checked, not applied blindly. A read-only TypeScript compiler-host substitution of `_ctx: ContextManager` with no parameter produces `src/di/generated/cronjob.ts:30 TS2554: Expected 0 arguments, but got 1`. The generator always supplies a ContextManager, so the existing parameter and disclosed lint Nit are retained rather than changing the shared generator or hand-editing generated code. No production file changed in this follow-up.

`pnpm api -- test test/domain/collectionPreferenceRead.test.ts test/domain/contentRecommendation.test.ts test/domain/userDeletionRecovery.test.ts --reporter=dot`: 44 passed, zero failed. `git diff --check` passed. The previous full-suite, typecheck, build and runtime evidence still describes unchanged production code; the follow-up's new tests are covered by this focused rerun. Neither merge nor deployment has occurred.

## Combined integration verification

On 2026-11-11, after reviewing the complete combined scope, the maintainer explicitly instructed integrating the owner-side work into this same PR. The instruction authorizes updating #566, not merging into `dev` or deploying. The previous owner patch was applied to this branch with a three-way merge so the already-reviewed subscriber changes and review fixes remain. The primary worktree is preserved as a historical source, not another deliverable. Only this change directory owns the combined specs; the standalone owner-only directory is not included in the PR.

### Additional implemented behavior

- Article entries retain `shared`, `inherited` or `none` instead of a resolved membership flag. Raw and centered user preferences preserve save/star weights; owner groups use one normalized contribution per member. Owner default sharing selects the groups at publication.
- Eligible/used and per-group member/missing counters update with entries and sums in one SQLite transaction. Publication no longer executes the old entry-table COUNT/SUM/MIN summary. A partial index locates the first missing member only if counters report one. Empty used groups are explicitly zeroed to avoid normalizing floating-point residue.
- A queued owner `publish` RPC coexists with article `apply` and explicit `rebuild`. Collection setting events no longer refresh every starred article or force a user-history rebuild. The explicit operator Collection refresh remains a rebuild.
- The state moves to `preference_state_v2` / `preference_entry_v2`. Legacy or absent state rebuilds once from existing article vectors; no re-embedding is performed. The old tables are removed transactionally only when replacement state is ready.
- A concrete rollback/re-upgrade defect was reproduced before fixing it: recreating legacy tables after v2 had been populated allowed a subsequent v2 publisher to reuse the old snapshot and omit an article added while rolled back. The real Workerd test failed (`rebuilds` remained 4 instead of 5). `read()` now treats legacy-table presence as uninitialized state. The same test passes after the fix: one rebuild includes the new article, drops legacy tables and subsequent calls remain incremental. This is a bounded schema-catalog read, not an article-table scan or a new recovery subsystem.

### Combined runtime and regression evidence

The merged focused suite first passed 223 tests across owner maintenance, subscriber reads, Workflow, task routes, ledger utilities, the real owner DO and the real Edge/Core HTTP harness. Additional combined runtime cases then exercised the same real Workerd SQLite owner object, publish RPC and maintenance service followed by the real subscriber aggregation and recommendation service using that object's published Collection vector. PostgreSQL and Vectorize remain explicit fixture boundaries.

- An owner's article vector replacement changes the stored owner Collection and the subscriber's next recommendation from candidate 301 to 302. No subscriber refresh is issued.
- Adding inheriting members, switching the owner default off/on and disabling/re-enabling the Collection alter the next subscriber result or cold-start state as expected. During each subscriber read, mutation, owner queue, rebuild and article-read counts remain unchanged; no `u:9:collection` record exists.
- Owner default and Collection status toggles cause no new owner-history rebuild or article-vector read. Subscriber preference agrees with the visible owner Collection vector to 10 decimal places. Unsubscribing yields cold start and re-subscribing restores reads without materialization.
- Existing real-object cases retain concurrent article batching, strict missing-member failure, recovery on settings that exclude a missing inherited member, exact counter recounts, an indexed first-missing plan, zero-data cleanup and initial v1 migration. The new rollback/re-upgrade case rebuilds only once and includes the intervening article.
- The existing actual Edge/Core HTTP scenario also passes on the combined tree, preserving authentication, source changes across requests, subscription mutation effects and cleanup-only legacy task behavior.
- PGlite comparisons verify that share-group classification plus owner default/status reproduces the previous membership SQL. Incremental sums match explicit full refreshes; partial-input and pagination behavior remains intact.

Current combined checks (all rerun, not inherited from the standalone branches):

- `pnpm api -- gen:all`: passed with public template and nonconnecting local generation URLs; no tracked generated changes.
- `pnpm api -- typecheck`: passed, including contracts.
- `pnpm api -- lint`: zero errors, 345 warnings, retaining the already-explained unused cron-context warning.
- `pnpm api -- test --reporter=dot`: **3,886 passed, 118 skipped, zero failed**; 245 files passed and 15 skipped.
- `openspec validate --all --strict`: **124 passed, zero failed**. Both incremental and partial-coverage delta archives still depend on archiving the already-merged `skip-missing-preference-vectors` first.
- Public-template Core, Edge, AI and Browser dry-run builds: all four passed, using a task-specific temporary output directory.
- `git diff --check`: passed.

### Combined review and operational boundaries

Bugs: the rollback/re-upgrade defect is fixed and regression-tested; source changes and share toggles flow through the owner aggregate into subscriber reads without fan-out. Counter updates and entry updates are atomic. Scope-limited operator refreshes do not publish unrelated profiles, and exact-zero handling prevents residual directions. Security: share groups preserve original authorization and publication semantics, SQL parameters stay bound, and no client route or new external service is introduced. The additional RPC is internal to the existing binding. Compliance: all owner requirements are now in the same change, the subscriber-only exclusion is superseded, and current verification covers the combined implementation rather than patch applicability alone. No Important finding remains open after local review.

The v2 layout requires a one-time per-owner rebuild, not deletion of native vectors or re-embedding. Deploy Core before Edge so the new publish RPC exists. Retain explicit rebuilds for missing state, changed mean version or unmatched old contributions. The PostgreSQL publication-time MAX query remains; this is not a claim that every database operation is constant-time. Moderation or source changes without a maintenance event still need existing explicit repair paths; source-event delivery is not changed. Interest clusters remain carried between rebuilds, and strict Collection missing-member behavior remains.

Production migration volume, live Vectorize latency, production Hyperdrive visibility and mixed-version rollout are not exercised by local fixtures. No production database, tunnel, deployment or live vector cleanup was used. The original primary worktree is retained unchanged; only the combined PR branch is delivered. No client package or shared client contract changes require a version bump.
