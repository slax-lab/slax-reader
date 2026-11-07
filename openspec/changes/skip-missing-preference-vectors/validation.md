# Validation

## Approval and scope

The human explicitly replaced the unimplemented HTML-recovery direction with missing-vector-tolerant user preferences and requested immediate implementation. This change covers both user article and user Collection preferences only. Collection representation aggregation, source-file recovery, live deployment and database/R2 writes are not included. The rejected plan was preserved under gitignored `.local/superseded-changes/` and is not part of this PR.

On 2026-11-07 the human also rejected per-event full recomputation, ruled out PostgreSQL state and Durable Objects, and directed implementing incremental maintenance directly on this branch. That work is recorded in the incremental sections below; remote migration, deployment and backfill remain outside this change.

## Implemented behavior

User refresh supplies coverage to the existing paged aggregate helper. Missing by-ID results increment `missing` and do not contribute to raw sums, centered sums or interest-cluster input. All pages finish before publication, and weighting/model parameters are unchanged. Valid partial results are written with `coverage: { eligible, used, missing }`; the existing Controller forwards this field and the operator retains only validated numeric counters.

Eligible history with no available vector reports `no_usable_preference_vectors` and leaves any old preference untouched. Truly empty history still deletes stale preferences. Native read errors, invalid vectors and write failures remain failures, not missing entries. Collection representation callers omit coverage and retain their strict missing-dependency behavior.

## Automated and runtime evidence

- Focused Service, centering and operator suites: 152 passed. Cases include partial article weighting, identical available input sets for raw/centered/interests, a fully missing first page followed by valid records, both preference kinds, all-missing preservation, empty-history deletion, operational read failures, invalid vectors, restored dependencies and numeric-only coverage output. Existing strict Collection tests remain green. No source or provider call is made by preference aggregation.
- Actual Workerd Edge/Core task routes plus Workflow and task-controller regression group: 130 passed. The runtime uses real generated routing, authentication, Controllers and VectorMaintenanceService with fixture repositories/native indexes. Both direct Core and Edge-forwarded preference requests with one available and one missing vector return `written` plus `{eligible:2,used:1,missing:1}`; all-missing requests return an explicit failure with zero mutations. This is real local runtime/HTTP behavior, not deployment verification.
- `pnpm api -- gen:all`: passed through the public configuration template; no hand-edited generated artifacts.
- `pnpm api -- typecheck`: passed, including contracts.
- `pnpm api -- lint`: zero errors, 344 existing warnings.
- `pnpm api -- test --silent --reporter=dot`: 3,838 passed, 117 existing environment-gated skips, zero failures; 241 files passed and 15 skipped.
- `pnpm exec openspec validate --all --strict`: 115 passed, zero failed.
- `pnpm agent:check`: passed, including generated workflow drift checks.
- Standard public-template four-Worker dry-run build: Core, Edge, AI and Browser passed; temporary outputs removed.
- `git diff --check`: passed.

## Incremental maintenance: implemented behavior

Article events now run retire, article write, apply. Retire subtracts the article's ledger contribution while its old vector still exists; apply reads the current weight with a single-row PostgreSQL query and the current stored vector and corrects the sums by the difference. The user article preference and one aggregate per Collection owner live in the new D1 table `slax_vector_preference_state`, written only with version-conditional insert, update and delete. Absent, outdated or inconsistent state is rebuilt once from current rows and existing vectors; the full refresh routes rebuild and persist it too. If the article write fails after retries, a restore step re-applies the article from its stored vector. Older publishers stand down, and visibility accepts a strictly newer published `state_version`. Interest clusters are still a full Ward computation over at most 2,000 recent actions at publish time.

The D1 migration was produced with `pnpm api -- gen:diff:d1` against the local D1 database and applied with `pnpm api -- migration:local:d1`. The generator also emitted a rebuild of the unrelated `slax_bookmark_share` table caused by pre-existing schema drift (its default uses `gen_random_uuid()`, which SQLite does not provide); that part was removed so the migration only creates the new table. The drift itself is unchanged and is not addressed here.

## Incremental maintenance: automated and runtime evidence

- New Service cases against the real Service, PGlite repository and fixture vector indexes, 8 passed: save, star, unstar, re-embed and delete events each equal an independent full recompute of raw, centered and interest output while `listUserArticles` is never called; absent and outdated-mean state rebuild once, then stay incremental; a vector replaced outside the event path forces a rebuild; a failed article write restores the old contribution; deleting the last article removes the profile and its state; three concurrent events converge with weights `[2, 2, 2]` and the newest `state_version` visible; an older publisher whose state is overtaken just before its write stands down, the newer state stays visible and both visibility checks pass (removing the pre-write check makes this test fail); an owner with two Collections publishes identical vectors equal to a full Collection refresh without enumerating members, reports `missing_dependency:a:1:3` for an absent member, and publishes once that vector exists.
- Mutation check: flipping the retire subtraction sign makes the event-sequence equality test fail; the source was restored afterwards.
- Real local D1 through Miniflare with the actual 00066 migration, 5 passed: exact round-trip of float64 sums, pending ledger entries and a 13-digit version; compact all-zero sums; a 120,000-entry ledger at the persistence cap stored and read in one row; insert, update and delete only against the expected version; two writers racing from one version produce exactly one winner.
- Ledger unit tests, 6 passed. Workflow tests, 15 passed, including the new step order and the restore step on a failed article write. Actual Workerd Edge/Core task route test passed.
- `pnpm api -- gen:all`, `typecheck`, `lint` (zero errors, 344 existing warnings), full `vitest run` (3,858 passed, 117 existing environment-gated skips; 243 files passed, 15 skipped), `pnpm exec openspec validate --all --strict` (115 passed), `pnpm agent:check`, four-Worker public-template dry-run build (Core, Edge, AI, Browser) and `git diff --check` all passed.
- Not verified in a running Workflow with remote D1 and Vectorize: there is no local Vectorize, and remote migration, deployment and test-environment writes are not authorized for this change. The Workflow step order is covered by the Workflow tests, and the state store by the real local D1 run.

## Incremental maintenance: known limitations

- The account-level snapshot-sharing setting and moderation outcomes that arrive without a later article event dispatch no maintenance, so the owner aggregate keeps the old eligibility until that owner's next Collection refresh or bulk refresh. Before this change, the next article event's full recompute absorbed them.
- State reuses the existing `DB` binding, so no private configuration change is required; each event makes at most four conditional writes to two rows there (the user's row, and the owner row only for Collection owners). A target with more than 120,000 ledger entries is not persisted and rebuilds on every event, as before.
- If a deleted user's article events permanently fail, that user's state row can remain, as their vectors already could.
- The remaining per-event history read is interest clustering over the recent window; online clustering is a separate change.

## Pull request review follow-up

The automated reviews of `122a1dd` and `451a105` reported no Important findings and five Nits, handled as follows.

- D1 row limit: the review cited 1 MB; Cloudflare's D1 limits page lists 2,000,000 bytes for a string, BLOB or row, and the real local D1 test now stores and reads a ledger at the 120,000-entry cap (about 1.94 MB). The cap is unchanged.
- Publish race: the newest-state check now runs immediately before each vector write or delete, covered by a deterministic interleaving test. Vector writes are still not conditional; the remaining window and its effect are recorded in the design.
- State keys now use `state:user-article:<id>` and `state:owner-collection:<id>`, so they no longer equal vector IDs in logs and errors. Nothing is deployed yet, so no data migration is needed.
- The operator `--help` text now names the `eligible`, `used` and `missing` coverage counters.
- The proposal records that archiving `vector-bulk-sync` must narrow its missing-vector preference scenario to the all-missing case.
- The review of `22d3eb6` added two Nits. The operator now forwards coverage only when `eligible === used + missing`. The ledger stores an explicit presence flag, so an all-zero fingerprint no longer needs remapping and stays distinct from a pending entry; the residual 64-bit collision risk is recorded in the design. That review run's gate failed on infrastructure: the Copilot API returned repeated HTTP 500 errors, which the harness classified as quota exceeded.

## Review and delivery boundaries

Bugs review confirms only absent records are skipped, successful enumeration accounts for every source, and no profile is published during a failed read or before aggregate completion. All-missing is distinct from empty eligible history. Security review is source-only and scoped: no authorization bypass, new destination, credentials, dependencies or source mutation; operator coverage discards arbitrary extra fields. Compliance review follows the human's explicit partial-preference decision, superseding the prior strict user-preference requirement while leaving Collection representation behavior unchanged. No new Important finding was identified in the partial-coverage diff. In the incremental diff, the Bugs pass found that a failed article write would leave the article retired; it is fixed with the restore step and covered by a test. The Compliance pass found the delta spec overstated that no other vectors are read while clustering still reads the recent window; the requirement now says so. The migration is additive (one new table), the D1 statements are parameterized, no destination, dependency or secret is added, and the state holds bookmark IDs and aggregate vectors already present in the user and Collection vector records. No Important finding remains open.

No CLI/Extension/Mobile source, contract consumer, dependency, build output or UI changes; no client version increment is required. Existing local security-skill files and skills-lock.json remain unrelated and uncommitted.

This run did not deploy, invoke live preference writes, change database/R2 records, regenerate articles or change EMBEDDING_MEAN. The API deployment workflow applies remote D1 migrations before deploying Workers (`.github/workflows/api-deploy.yml`), so the new table exists before the new code runs. Existing vectors do not need deletion: state seeds on each target's next event, or by rerunning the `article-preference` and `collection` refresh stages, which read existing vectors and never call Jina. After normal review/merge/deployment, only affected preference targets need recomputation. Users with at least one available eligible vector can recover; users with all vectors absent remain explicitly unavailable rather than being counted as repaired.
