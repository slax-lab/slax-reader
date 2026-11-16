# Proposal

## Why

The real local save of `https://pca.st/8ueht2r9` (source `551ced75c7efa5809abc10dd7088c949`, 569 cues, approximately 86 minutes) identified unused integer response fields as the trigger for repeating-digit output loops; removing those fields eliminated the observed runaway replies. A subsequent quality failure rejected a legitimate short backchannel at distant cues, so recovery must also distinguish natural repetition from doubled content.

## What Changes

- Use a podcast-only polish schema without integer fields; derive section timestamps and document version locally instead of asking the model to generate them.
- Pre-split actual serialized requests and set an input-proportional output limit with headroom, capped at 65,536 rather than requesting that maximum for every call. Keep temperature 1.0 and LOW thinking as model alignment, not the proven fix.
- Keep binary splitting for truncation/timeouts as a safety net, with three bounded in-attempt tries for indivisible units and retryable exhaustion.
- Reuse successful caches and known splits, preserve source references and translation identities, and increase the rolling pool from five to ten workers; cost admission still bounds actual calls.
- Strip contextual overlap IDs from mixed paragraphs as well as dropping overlap-only paragraphs, preventing backward paragraph start times across chunks.
- Reject backward paragraph cue starts within and across sections, while permitting shared starts.
- Validate the first part's introduction and polish parts against their own cues before caching, with small-sample number/length exemptions, so only rejected parts regenerate.
- Allow one assemble-time quality repair: redo affected polish chunks (or all when untargetable), redo all translation chunks, then publish only if revalidation passes.
- Exempt exact repeats shorter than 40 characters from podcast duplicate detection only when they reference different cues; retain long-repeat and same-cue checks.
- Count Chinese 万/亿 magnitudes as equivalent numeric values in podcast quality checks; preserve YouTube's default duplicate and numeric behavior.
- Preserve the $1 episode and $30 daily limits, requested-cap reservations, rejection accounting, abort deadlines, and count-only diagnostics.
- Record real local capture/publication evidence separately from mocked regressions; no remote deployment or repair is part of this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: bounded generation, source-aligned references, part-level quality, one-pass repair, ten-worker scheduling, and podcast-specific quality equivalences.

## Impact

API podcast runner, podcast utilities, workflow accounting and existing tests. The shared quality checker adds opt-in minimum duplicate length (default zero) Chinese magnitude matching (default false), and paragraph-order enforcement (default false), preserving YouTube behavior. No database migration, dependency, UI redesign, YouTube runner change or shared model-limit change. Generated artifacts remain generator-owned.

## Approval and sequencing

On 2026-11-03 the user approved implementation and real local full-stack verification. The user then asked for chunk generation to be made stable and retested, which added: ten workers, overlap-ID stripping, part gates, one-pass repair and Chinese magnitude matching. These refine the earlier fixed-maximum approach without authorizing remote deployment.

Earlier merged or sibling podcast concurrency deltas specified at most five calls. This change explicitly supersedes that bound with ten workers and at most ten active calls, still subject to the same cost admission limits. Reconcile same-capability deltas in dependency order when archiving; do not leave contradictory concurrency bounds in the resulting specification.

This follows merged PR #487 and its `resolve-pocket-casts-short-links` delta. Archive the preceding podcast deltas first or together in dependency order; do not archive this change before its task PR merges. No remote deployment, remote data repair, or remote job retry is authorized by this task.

On 2026-11-04, the user confirmed human hands-on acceptance and requested another performance run followed by a pull request to dev if performance is satisfactory. The pre-PR review closes the reproduced paragraph-order and empty-introduction defects within the existing quality-admission scope. The concurrency delta modifies the preceding "Concurrent readable podcast articles" requirement so archival replaces the five-call bound. Archive the preceding merged capability changes before this change.
