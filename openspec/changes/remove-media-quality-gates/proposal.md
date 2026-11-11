# Proposal

## Why

Nonempty model output is repeatedly rejected by numeric, length, language and duplication heuristics. The test podcast completed transcription but two of twenty chunks exhausted repeated attempts on number coverage, preventing delivery of the entire article.

## What Changes

- Accept nonempty generated content without semantic, ratio, language, numeric, duplication, speaker-name or cue-reference quality gates in both media pipelines.
- Remove content-driven repair and regeneration. Retain bounded recovery for empty/missing output, malformed protocol data, provider failures and truncation.
- Remove YouTube eligibility scoring: nonempty captions can generate regardless of duration, text volume, title, language or readability estimates.
- Preserve source-owned timing/mapping, storage verification, leases, access control, Labs, moderation and takedown behavior. Record counts and execution errors without logging transcript/model bodies.
- No compatibility branches, schema migration, provider changes or new configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: Nonempty content acceptance for polishing and translation.
- `youtube-ai-article`: Nonempty caption admission and nonempty content acceptance.

## Impact

API runners, generation helpers, caption admission, tests and runtime smoke evidence. No client code, API shape, dependencies or application package output changes.

## Conversation approval

On 2026-11-09 the user reviewed the inventory of both pipelines and instructed removal of all unnecessary checks except emptiness, with diagnostic logging permitted. This implements that reviewed scope. The preceding cap-removal change is already merged in PR #537; this task is sequenced after it and will not archive it.
