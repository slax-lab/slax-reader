# Proposal

## Why

Seven test users cannot refresh their article preferences because one eligible article vector is absent. The shared aggregate helper treats a single missing member as a fatal error. The human explicitly rejected source-file recovery and directed that user preferences compute from available vectors rather than abort the whole user.

Every article event also recomputes the user's entire article history and every owned Collection from scratch: one save, star, delete or re-embed pages all eligible rows from PostgreSQL and reads every article vector again, and a sync touching many articles repeats that work once per article. The human rejected full recomputation per event and directed incremental maintenance on this branch, without PostgreSQL state tables or Durable Objects.

## What Changes

- Skip absent source vectors only when recomputing user article or Collection preferences. Read all eligible pages, then publish the final result from the available valid vectors.
- Use the same available article set for raw preference, centered preference and interest clustering. Preserve existing weights and algorithms.
- Return numeric coverage (`eligible`, `used`, `missing`) and retain it in safe operator summaries. Partial writes remain successful writes with explicit coverage, not falsely complete input coverage.
- If eligible sources exist but all vectors are missing, report failure and preserve the old profile. A truly empty eligible history retains existing stale-profile deletion behavior.
- Keep operational read errors, invalid vectors and write failures explicit; do not change strict Collection representation aggregation or retry architecture.
- Maintain the user article preference and the owner Collection aggregate incrementally. An article event subtracts the article's previously applied contribution before its vector is written and adds its current contribution afterwards, so a normal event reads one article vector instead of the whole history.
- Persist each aggregate in a new D1 table with its sums, a per-article ledger of applied weight and vector fingerprint, and a version used for conditional writes. Missing, outdated or inconsistent state is rebuilt once from current rows and existing vectors; Jina is never called for this.
- Compute one aggregate per Collection owner and publish it to each of that owner's Collections. Concurrent events converge on the latest state; an older publisher stands down and visibility checks accept a newer published state.
- Interest clusters remain a full Ward computation over the recent action window at publish time; online clustering is a later change.

## Capabilities

### New Capabilities

- `preference-partial-coverage`: Defines partial-data tolerance and coverage accounting specifically for user preferences.
- `preference-incremental-maintenance`: Defines event-driven incremental maintenance of user article preferences and owner Collection aggregates, their persisted state and rebuild rules.

### Modified Capabilities

None in living specs. This human-approved follow-up supersedes the strict missing-source-vector rule for user preferences in the already-merged, not-yet-archived `vector-bulk-sync` and `preference-maintenance` change records, and the `vector-v5-recommendation` design decision to recompute every event from current rows without a vector ledger. Published values still equal a recomputation from current eligible rows. Collection representations remain strict; archive these follow-ups in order. When `vector-bulk-sync` is archived, its preference-task scenario "Source vector is missing" must be narrowed to the all-missing case so living specs do not contradict `preference-partial-coverage`.

## Impact

`VectorMaintenanceService`, the maintenance Workflow article steps, the PostgreSQL read repository, a new D1 table `slax_vector_preference_state` with its migration and store, the refresh result type, the operator response summarizer, and existing regression tests. No source recovery, new network destinations, dependencies, credentials, client packages or request-body changes. The standard API deployment already applies remote D1 migrations before deploying Workers, so the table exists before the new code runs. Existing article, user and Collection vectors keep their formats and are reused; state is seeded lazily on each target's next event or by rerunning the existing preference and Collection refresh stages. The unimplemented HTML-recovery proposal is superseded and preserved only under gitignored `.local/superseded-changes/`.

## Approval

The human explicitly confirmed skipping missing source vectors and proceeding with the repair on 2026-11-07. No further planning confirmation is required for this scoped change. On the same day the human rejected per-event full recomputation, ruled out PostgreSQL state and Durable Objects, and directed implementing incremental maintenance directly on this branch and pull request. Database and R2 remain read-only during verification; no deployed configuration, remote migration or production data change is authorized here.
