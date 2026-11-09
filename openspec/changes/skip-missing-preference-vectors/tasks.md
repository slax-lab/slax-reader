# Tasks

## 1. Preference-only tolerance

- [x] 1.1 Add user-preference coverage and skip absent source vectors while preserving strict Collection aggregation; verify partial article and Collection preference tests, same-set centered calculations and pagination after an entirely missing page.
- [x] 1.2 Preserve old profiles for all-missing eligible sources, retain deletion for empty history and fail on operational/invalid-vector errors; verify no unintended upsert/delete/provider calls occur.
- [x] 1.3 Preserve validated numeric coverage in operator summaries and existing HTTP result forwarding; verify malformed coverage cannot leak arbitrary fields and older responses remain supported.

## 2. Verification and delivery

- [x] 2.1 Exercise the real Service and task Controller chain in the existing local test runtime with missing-vector fixtures, verify partial writes and coverage, and confirm no source recovery or Jina calls.
- [x] 2.2 Run generation, API typecheck/lint/full tests, strict OpenSpec and four-Worker dry-run builds; record evidence and complete scoped Bugs/Security/Compliance review before delivering the fix PR to dev, without deploying or modifying live source data.

## 3. Incremental maintenance

- [x] 3.1 Remove the unmerged D1 state table, migration, store and conditional-write maintenance; add the SQLite-backed `VectorPreferenceObject` with its entry and state tables, an in-memory one-batch-at-a-time queue, the `VECTOR_V5_PREFERENCE` binding, the public template migration tag and the deployment check; verify real SQLite round-trips and batching in an actual Workerd run.
- [x] 3.2 Apply article batches by fingerprint against the current or handed-over previous vector with one PostgreSQL query and one batched vector read; rebuild once for absent, outdated or inconsistent state; verify save, star, unstar, re-embed and delete sequences equal a full recompute without reading history or the recent window, a failed article write leaves the aggregate unchanged, and the last deletion removes the profile and clears state.
- [x] 3.3 Carry interest clusters between rebuilds and drop a cluster whose medoid leaves; verify a save keeps clusters and a medoid deletion removes its cluster.
- [x] 3.4 Publish one owner aggregate to every owner Collection and keep missing members strict; rebuild the owner on Collection events and refresh routes; verify equality with a full Collection refresh and recovery once the member vector exists.
- [x] 3.5 Make the article Workflow hand over the previous representative vector and apply then verify in one retried step; verify concurrent applies combine into fewer batches with the expected weights and that a stale visible record is republished.
- [x] 3.6 Run generation, typecheck, lint, full tests, strict OpenSpec, four-Worker dry-run builds and the scoped pre-push review; record the evidence before updating the pull request.

## 4. Layer architecture test

- [x] 4.1 Add an API-wide layer test with a ratcheting baseline, at the maintainer's direction on this branch; verify every detector on flagged and allowed samples, that a new violation and a fixed baselined one each fail, and that this branch adds no violation.
