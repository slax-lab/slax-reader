# Tasks

## 1. Preference-only tolerance

- [x] 1.1 Add user-preference coverage and skip absent source vectors while preserving strict Collection aggregation; verify partial article and Collection preference tests, same-set centered calculations and pagination after an entirely missing page.
- [x] 1.2 Preserve old profiles for all-missing eligible sources, retain deletion for empty history and fail on operational/invalid-vector errors; verify no unintended upsert/delete/provider calls occur.
- [x] 1.3 Preserve validated numeric coverage in operator summaries and existing HTTP result forwarding; verify malformed coverage cannot leak arbitrary fields and older responses remain supported.

## 2. Verification and delivery

- [x] 2.1 Exercise the real Service and task Controller chain in the existing local test runtime with missing-vector fixtures, verify partial writes and coverage, and confirm no source recovery or Jina calls.
- [x] 2.2 Run generation, API typecheck/lint/full tests, strict OpenSpec and four-Worker dry-run builds; record evidence and complete scoped Bugs/Security/Compliance review before delivering the fix PR to dev, without deploying or modifying live source data.

## 3. Incremental maintenance

- [x] 3.1 Add the D1 `slax_vector_preference_state` table through the D1 migration generator and a store with version-conditional insert, update and delete; verify blob round-trips, compact zero sums and a single winner between racing writers on a real local D1.
- [x] 3.2 Maintain user article state by retire before and apply after the article write, with lazy rebuild for absent, outdated or inconsistent state; verify save, star, unstar, re-embed and delete sequences equal a full recompute without paging history, that a failed article write restores the old contribution, and that the last deletion removes the profile and its state.
- [x] 3.3 Compute one owner Collection aggregate incrementally, publish it to every owner Collection and keep missing members strict; verify equality with a full Collection refresh and recovery once the member vector exists.
- [x] 3.4 Reorder the article Workflow into retire, article, preference and owner Collection steps; make older publishers stand down and visibility accept a newer published state; verify concurrent events converge on one state with the expected weights.
- [x] 3.5 Run generation, typecheck, lint, full tests, strict OpenSpec, four-Worker dry-run builds and the scoped pre-push review; record the evidence before updating the pull request.
