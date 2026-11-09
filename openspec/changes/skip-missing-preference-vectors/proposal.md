# Proposal

## Why

Seven test users cannot refresh their article preferences because one eligible article vector is absent. The shared aggregate helper treats a single missing member as a fatal error. The human explicitly rejected source-file recovery and directed that user preferences compute from available vectors rather than abort the whole user.

Every article event also recomputes the user's entire article history and every owned Collection from scratch: one save, star, delete or re-embed pages all eligible rows from PostgreSQL and reads every article vector again, and a sync touching many articles repeats that work once per article. The human rejected full recomputation per event and directed incremental maintenance on this branch, without PostgreSQL state tables.

## What Changes

- Skip absent source vectors only when recomputing user article or Collection preferences. Read all eligible pages, then publish the final result from the available valid vectors.
- Use the same available article set for raw preference, centered preference and interest clustering. Preserve existing weights and algorithms.
- Return numeric coverage (`eligible`, `used`, `missing`) and retain it in safe operator summaries. Partial writes remain successful writes with explicit coverage, not falsely complete input coverage.
- If eligible sources exist but all vectors are missing, report failure and preserve the old profile. A truly empty eligible history retains existing stale-profile deletion behavior.
- Keep operational read errors, invalid vectors and write failures explicit; do not change strict Collection representation aggregation or retry architecture.
- Maintain the user article preference and the owner Collection aggregate incrementally in one SQLite-backed Durable Object per user. Calls for one user are processed one batch at a time; different users never wait for each other. No alarms, leases, pending tables or version-conditional writes are used.
- The object stores, per eligible article, the applied weight, the Collection membership flag and an 8-byte fingerprint of the applied vector, not the vector itself, plus float64 raw, centered and owner Collection sums, the embedding mean version, the carried interest clusters and a monotonic state sequence.
- An article event writes the article vector as today and hands over the previous representative vector when it replaced or deleted one. It then asks the user's object to apply the article. A batch reads current weight and membership with one PostgreSQL query and the current vectors with one batched read, subtracts the applied contribution identified by fingerprint, adds the current one, commits locally and publishes. The Workflow verifies the published records; a failed check applies again and republishes.
- Missing state, state built with another mean version, or an applied fingerprint that matches neither the current nor the handed-over vector is rebuilt once from current rows and existing vectors; Jina is never called for this. The existing full refresh routes rebuild through the same object.
- Interest clusters are recomputed only during a rebuild. Incremental batches keep the stored clusters and drop a cluster whose medoid article left the preference; a new save never reads the recent action window. Clusters currently have no production reader because the article feed is paused.
- Compute one aggregate per Collection owner and publish it to each of that owner's Collections. A Collection event refreshes the owner's starred articles and then rebuilds the owner's object, so share-setting changes are applied.
- The subscribed-Collection preference keeps its existing full recomputation over the user's few subscribed Collections.

## Capabilities

### New Capabilities

- `preference-partial-coverage`: Defines partial-data tolerance and coverage accounting specifically for user preferences.
- `preference-incremental-maintenance`: Defines event-driven incremental maintenance of user article preferences and owner Collection aggregates, their per-user state and rebuild rules.

### Modified Capabilities

None in living specs. This human-approved follow-up supersedes the strict missing-source-vector rule for user preferences in the already-merged, not-yet-archived `vector-bulk-sync` and `preference-maintenance` change records, and three `vector-v5-recommendation` design decisions: recomputing every event from current rows without a ledger, adding no locks, and recomputing clusters at every article-preference refresh. Published values still equal a recomputation from current eligible rows. Collection representations remain strict; archive these follow-ups in order. When `vector-bulk-sync` is archived, its preference-task scenario "Source vector is missing" must be narrowed to the all-missing case so living specs do not contradict `preference-partial-coverage`.

## Impact

`VectorMaintenanceService`, the maintenance Workflow article step, the PostgreSQL read repository, a new Core Durable Object class `VectorPreferenceObject` with its SQLite store and the `VECTOR_V5_PREFERENCE` binding, the public configuration template, the deployment check, the refresh result type, the operator response summarizer, and existing regression tests. The unmerged D1 table `slax_vector_preference_state`, its migration and store are removed; they were never deployed. No source recovery, new network destinations, dependencies, credentials, client packages or request-body changes. Operators add the Durable Object binding and a new `new_sqlite_classes` migration tag to their private configuration before deploying; the deployment check rejects a configuration without them. Existing article, user and Collection vectors keep their formats and are reused; object state is built on each user's next event or by rerunning the existing preference and Collection refresh stages. The unimplemented HTML-recovery proposal is superseded and preserved only under gitignored `.local/superseded-changes/`.

## Approval

The human explicitly confirmed skipping missing source vectors and proceeding with the repair on 2026-11-07. No further planning confirmation is required for this scoped change. On the same day the human rejected per-event full recomputation, ruled out PostgreSQL state and directed implementing incremental maintenance directly on this branch and pull request. On 2026-11-09, after reviewing D1 conditional-write and lease-and-pending alternatives, the human chose one Durable Object per user as a plain per-user queue without alarms or stored vector copies, asked that a new save never recompute clusters from the recent window, and directed revising this change and implementing it. Database and R2 remain read-only during verification; no deployed configuration, remote migration or production data change is authorized here.
