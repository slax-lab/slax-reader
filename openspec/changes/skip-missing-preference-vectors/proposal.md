# Proposal

## Why

Seven test users cannot refresh their article preferences because one eligible article vector is absent. The shared aggregate helper treats a single missing member as a fatal error. The human explicitly rejected source-file recovery and directed that user preferences compute from available vectors rather than abort the whole user.

## What Changes

- Skip absent source vectors only when recomputing user article or Collection preferences. Read all eligible pages, then publish the final result from the available valid vectors.
- Use the same available article set for raw preference, centered preference and interest clustering. Preserve existing weights and algorithms.
- Return numeric coverage (`eligible`, `used`, `missing`) and retain it in safe operator summaries. Partial writes remain successful writes with explicit coverage, not falsely complete input coverage.
- If eligible sources exist but all vectors are missing, report failure and preserve the old profile. A truly empty eligible history retains existing stale-profile deletion behavior.
- Keep operational read errors, invalid vectors and write failures explicit; do not change strict Collection representation aggregation or retry architecture.

## Capabilities

### New Capabilities

- `preference-partial-coverage`: Defines partial-data tolerance and coverage accounting specifically for user preferences.

### Modified Capabilities

None in living specs. This human-approved follow-up supersedes the strict missing-source-vector rule for user preferences in the already-merged, not-yet-archived `vector-bulk-sync` and `preference-maintenance` change records. Collection representations remain strict; archive these follow-ups in order.

## Impact

`VectorMaintenanceService`, its refresh result type, the operator response summarizer, and existing regression tests. No source recovery, new network destinations, dependencies, tables, credentials, client packages or request-body changes. The unimplemented HTML-recovery proposal is superseded and preserved only under gitignored `.local/superseded-changes/`.

## Approval

The human explicitly confirmed skipping missing source vectors and proceeding with the repair on 2026-11-07. No further planning confirmation is required for this scoped change. Database and R2 remain read-only during verification; no deployed configuration or production data change is authorized here.
