# Proposal

## Why

Native sharing can time out while waiting for a response even though the bookmark was saved. The owner requests a five-second create timeout followed by one URL check using the existing bookmark-existence API.

## What Changes

- Keep the five-second total add-URL deadline on iOS and Android and existing success/error/cancellation presentation.
- On an ambiguous create timeout, call existing `POST /v1/bookmark/exists` once with the original extracted `target_url`, captured token, and selected API origin.
- Give the recheck three seconds including response-body download. HTTP 200 with JSON `data.exists` equal to boolean `true` means success; false, invalid/missing data, errors, or recheck timeout means the existing timeout message. Never resubmit add_url.
- Remove the new receipt endpoint, receipt methods, special repository queries, Twitter resolver signal plumbing, and receipt-specific API tests introduced in PR #509. Regenerate route registration through its owner. The existing API behavior remains unchanged.
- Keep the approved version `1.0.28`, build `800`, previous source bound `799`; this is a correction to that same work, not another version increment.

## Capabilities

### New Capabilities

- `mobile-share-save-recovery`: Bounded native timeout recovery using existing bookmark-existence semantics.

### Modified Capabilities

None. Existing API lookup and general mobile sharing presentation contracts are unchanged.

## Impact

Native share sources and focused host tests only, plus removal of the superseded backend additions. Generated iOS source copies remain owned by `with-share.cjs`. No new API, dependency, database schema, or workflow change remains.

## Non-goals

No special handling for URL normalization, aliases, trash, Reader forks, or parse readiness beyond whatever `/exists` already does. No new saved-state contract, polling, create retry, UI redesign, native build/device matrix, or manual acceptance gate.

## Owner Correction and Delivery

After PR #509 merged, the owner explicitly rejected the extra receipt API and instructed using `/exists` as-is. This document supersedes the earlier receipt design. The corrective branch is `fix/share-recovery-use-exists` from current `origin/dev`, in the same isolated worktree. Acceptance is relevant automated unit/host tests and iOS/Android bundle verification. Prepare a corrective PR; do not merge, deploy, sign, or publish.
