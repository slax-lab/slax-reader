# Proposal

## Why

The production audit found that the incremental vector path still couples optional source failures to whole articles, requires complete Collection coverage, falls back to full-history work, and treats accepted asynchronous cleanup as failure. Existing tests encode several of these restrictions rather than the user's requirement: use available valid contributions, isolate local failures, and update only affected state.

## What Changes

- Independently use available stored text and images; reject only the unusable contribution, not its usable siblings. Preserve operational/authentication failures. Recognized provider image decode, geometry and pixel-limit rejections are optional-image skips.
- Let user and owner Collection aggregates publish partial valid coverage, clear obsolete projections when no valid contribution remains, and isolate malformed individual stored vectors.
- Keep actual applied contributions, member timestamps and a bounded recent-action window in the existing owner object so updates/deletes do not need the replaced vector or a full-history fallback. Bootstrap absent/legacy state once.
- Separate relation-only changes from source processing; propagate explicit article repairs to owner projections without subscriber fan-out or a separate full rebuild.
- Track source/image availability in article reuse and separate asynchronous deletion acceptance from visibility verification. Isolate deterministic bad batch inputs.
- Replace tests and normative clauses that require strict missing-member failure, frozen interests or routine full rebuilds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vector-v5-runtime`: Independent available-source processing, repair-sensitive reuse, batch isolation, and asynchronous cleanup.
- `vector-image-input-validation`: Isolate confirmed image content/geometry rejection while retaining genuine service failures.
- `preference-maintenance`: Contribution-backed incremental maintenance, partial Collection publication, non-stale empty state, bounded current interests, and relation-only hooks.
- `vector-bulk-sync`: Article repair schedules incremental owner propagation rather than requiring full-history downstream repair.

## Impact

API source preparation, embedding, vector maintenance, owner-object storage, workflow/hook dispatch and their existing tests. No new dependency, PostgreSQL schema/migration, external platform, subscriber fan-out, production reindex, source mutation or deployment. The existing owner-object state is upgraded through a local versioned layout and one-time current-state bootstrap; production source data and article indexes are retained.

## Approval

On 2026-11-11 the user reviewed the complete audit, required the omissions to be fixed together rather than through repeated releases, and explicitly requested removal of the other worktrees and implementation in a new worktree. This is the unified implementation of that approved scope. Earlier merged deltas that retain strict Collection dependencies or frozen interest clusters are superseded by this repair's explicit requirements; they are not compatibility constraints for the new behavior.
