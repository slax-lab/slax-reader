# Design

## Context

The runner awaits each chunk before starting the next chunk.
The v2 path reads the preceding edit and translation for context.
Each model call reads recorded spend before it starts. Parallel calls could all read the same balance.
The existing claim permits one active run per article row.

## Goals / Non-Goals

Reduce generation time through bounded concurrency while preserving source coverage, output order, retry caches, and spending limits.
Keep the change within the API generation path. Keep full-article validation before publication.

## Decisions

### Execute deterministic batches of five chunks

Retain one durable step per chunk with its existing index and cache key.
Start five indexed steps together and await all results before starting the next batch.
Use settled results so a failure cannot finish the article while sibling steps still write results or costs.
After a failure, start no later batch. Successful sibling results remain available for retry.

A rolling worker pool can reduce idle time further, but complicates durable replay and failure settlement.
An unbounded Promise.all would allow up to 40 simultaneous chunk calls per article.
Five is an internal limit, not a user setting.

### Use immutable source context

Give each chunk bounded neighboring transcript context, clearly marked as context that must not appear in the output.
Keep context selection independent of completion order.
Within a chunk, retain edit-before-translation order and continuity between split parts.
Keep source cue identifiers and paragraph references under the existing validation rules.

The fidelity instruction and response format remain unchanged. Context no longer depends on another generated chunk.
Reuse valid cached results under the existing version; do not replace ready articles or reset accumulated spend.

### Admit concurrent model calls safely

Serialize budget admission and cost settlement within the active run, but release that lock during model requests.
Track reservations for active requests alongside persisted spend. Reserve the configured maximum output cost and estimated input cost before admission.
When capacity is reserved by another call, wait for settlement and recheck before declaring a budget failure.
Record actual usage before releasing a successful call's reservation. Release reservations on errors without hiding accounting failures.
Reconstruct admission from persisted spend and currently executing requests during workflow replay.
Completed durable steps do not reserve or charge again.

Preserve the $1 run cap, $2 lifetime cap, and existing ownership checks.
Test that concurrent callers cannot each claim the same remaining budget.

### Keep publication ordered

Read completed chunks by source index during assembly. Keep the introduction and all quality checks before publication.
Add elapsed milliseconds to model-call and chunk events. Log identifiers and counts only.

## Risks / Trade-offs

- Terminology can vary without previous translated context. Check names, numbers, and boundary passages in a translated runtime sample.
- A slow chunk delays its batch. Use a 90-second request deadline within an eight-minute chunk attempt and preserve durable step retries; measure before adding a rolling pool.
- Conservative reservations can reduce concurrency near the budget limit. Wait for active calls before deciding that the remaining budget is insufficient.
- Workflow replay can skip completed steps. Test replay, cached chunks, failures, and accounting together.
- Provider latency and throttling limit the speed gain. Report observed timing separately from controlled test timing.

## Delivery

Run the focused runner tests, API checks, strict OpenSpec validation, and the three review passes in REVIEW.md.
Exercise the runner with controlled delayed responses in a running environment. Attempt a real-model run through authorized access.
Record any unavailable provider or dev access as a verification gap. Do not claim live improvement from a stubbed model.
Open one PR to dev and resolve agent review findings. Archive after merge, after the preceding truncation change.
