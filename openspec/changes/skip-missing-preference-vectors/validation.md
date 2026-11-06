# Validation

## Approval and scope

The human explicitly replaced the unimplemented HTML-recovery direction with missing-vector-tolerant user preferences and requested immediate implementation. This change covers both user article and user Collection preferences only. Collection representation aggregation, source-file recovery, live deployment and database/R2 writes are not included. The rejected plan was preserved under gitignored `.local/superseded-changes/` and is not part of this PR.

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

## Review and delivery boundaries

Bugs review confirms only absent records are skipped, successful enumeration accounts for every source, and no profile is published during a failed read or before aggregate completion. All-missing is distinct from empty eligible history. Security review is source-only and scoped: no authorization bypass, new destination, credentials, dependencies or source mutation; operator coverage discards arbitrary extra fields. Compliance review follows the human's explicit partial-preference decision, superseding the prior strict user-preference requirement while leaving Collection representation behavior unchanged. No new Important finding was identified in this diff.

No CLI/Extension/Mobile source, contract consumer, dependency, build output or UI changes; no client version increment is required. Existing local security-skill files and skills-lock.json remain unrelated and uncommitted.

This run did not deploy, invoke live preference writes, change database/R2 records, regenerate articles or change EMBEDDING_MEAN. After normal review/merge/deployment, only affected preference targets need recomputation. Users with at least one available eligible vector can recover; users with all vectors absent remain explicitly unavailable rather than being counted as repaired.
