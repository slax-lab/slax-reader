# Proposal

## Why

YouTube article generation processes every chunk in sequence, even when the transcript already exists.
An estimated 12-chunk translated article requires 25 sequential model calls before publication.

## What Changes

- Process up to five chunks concurrently within one article run.
- Replace cross-chunk output dependencies with bounded context from the immutable transcript.
- Preserve edit-before-translation order within each chunk and assemble results in source order.
- Include concurrent calls in budget admission and wait for active chunks before ending a failed run.
- Preserve cached results, truncation recovery, coverage checks, and publication guards.
- Record call and chunk durations without transcript text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `youtube-ai-article`: bounded concurrent generation with ordered publication and safe failure settlement.

## Impact

The API runner, its context prompts, and its tests change. No new dependency or public API field is required.
The existing model, spending limits, and article format remain in use.
The preceding truncation recovery change merged in PR #457. Archive that change before this change to preserve specification order.

## Scope

This change reduces sequential waiting. It does not promise a fixed provider response time.
Model replacement, partial publication, UI changes, and changes to scheduled retry delays are outside this change.

## Human review

On 2026-11-02, Luca requested concurrent processing, a pull request, and agent review.
On 2026-11-02, Luca approved the proposal with five concurrent chunks and instructed implementation to continue.
