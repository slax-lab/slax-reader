# Proposal

## Why

The production audit found that the incremental vector path still couples optional source failures to whole articles, requires complete Collection coverage, falls back to full-history work, and treats accepted asynchronous cleanup as failure. Existing tests encode several of these restrictions rather than the user's requirement: use available valid contributions, isolate local failures, and update only affected state.

## What Changes

- Independently use available stored text and images; reject only the unusable contribution, not its usable siblings. Preserve operational/authentication failures. Recognized provider image decode, geometry and pixel-limit rejections are optional-image skips.
- Let user and owner Collection aggregates publish partial valid coverage, clear obsolete projections when no valid contribution remains, and isolate malformed individual stored vectors.
- Store preference state in the existing API D1 database: per-user Float64 sums and counts, and per-article weight, share group, 8-byte vector token and publication time. No article vector is stored. The path that replaces or deletes an article vector hands the replaced vector to owner maintenance for exact subtraction. The per-owner Durable Object only serializes maintenance; legacy state in its storage moves to D1 once and the object storage is erased. Bootstrap absent state once.
- Recompute interest clusters from the bounded PostgreSQL action window on rebuild and explicit refresh; ordinary events carry stored clusters.
- Separate relation-only changes from source processing; propagate explicit article repairs to owner projections without subscriber fan-out or a separate full rebuild.
- Track source/image availability in article reuse and separate asynchronous deletion acceptance from visibility verification. Isolate deterministic bad batch inputs.
- Replace tests and normative clauses that require strict missing-member failure, frozen interests or routine full rebuilds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `vector-v5-runtime`: Independent available-source processing, repair-sensitive reuse, batch isolation, and asynchronous cleanup.
- `vector-image-input-validation`: Isolate confirmed image content/geometry rejection while retaining genuine service failures.
- `preference-maintenance`: D1-backed incremental maintenance with handed-over old vectors, partial Collection publication, non-stale empty state, bounded interests on refresh, and relation-only hooks.
- `vector-bulk-sync`: Article repair schedules incremental owner propagation rather than requiring full-history downstream repair.

## Impact

API source preparation, embedding, vector maintenance, preference storage, workflow/hook dispatch and their existing tests. One D1 migration (`00066_add_vector_preference_state`) adds two tables to the existing `DB` binding; it runs with the existing `migration:remote:d1` deploy step. No new dependency, binding, PostgreSQL schema/migration, external platform, subscriber fan-out, production reindex, source mutation or deployment. Existing owner-object state is moved to D1 lazily and the object storage is erased; production source data and article indexes are retained.

## Approval

On 2026-11-11 the user reviewed the complete audit, required the omissions to be fixed together rather than through repeated releases, and explicitly requested removal of the other worktrees and implementation in a new worktree. This is the unified implementation of that approved scope. Earlier merged deltas that retain strict Collection dependencies or frozen interest clusters are superseded by this repair's explicit requirements; they are not compatibility constraints for the new behavior.

On 2026-11-12, after this change merged to dev and deployed to the test environment, the user rejected keeping applied contribution vectors permanently in Durable Object storage (cost and an unbackupable ledger) and directed that persistent state go to D1 while the Durable Object only limits concurrency. The user then asked to fix it directly on this change after a revert attempt failed. The storage and interest decisions above reflect that direction.
