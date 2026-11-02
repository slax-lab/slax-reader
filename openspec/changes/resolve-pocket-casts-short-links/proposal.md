# Proposal

## Why

Pocket Casts share links such as `https://pca.st/6rpkp8cj` save as normal pages, even after PR #406 merged.
The resolver excludes `pca.st`, so podcast detection receives the unresolved short code and rejects it.

## What Changes

- Resolve Pocket Casts share links before podcast detection through the existing public redirect resolver.
- Route resolved episode links through the existing podcast capture flow when the owner enables podcast Labs.
- Preserve normal page capture for show links, unresolved links, and accounts without podcast Labs.
- Preserve URL safety checks, bookmark identity, and annotation protection during recapture.
- Add regression coverage for the reported link and its redirect destination.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: recognize Pocket Casts short-code share links through their resolved episode destination.

## Impact

The implementation affects the API capture resolver and its tests. It needs no dependency, API contract, database, or client package change.
The existing player and notes presentation remains the expected result.
Web and API releases do not require package-version increments.

## Non-goals

This change does not enable Labs, replace annotated bodies, introduce a new player, or automatically recapture stored bookmarks.
It does not change transcript providers, spending limits, or generation rules.

## Sequencing and review

PR #406 merged as `89fbf35e`; this change follows its implementation.
Archive this delta after `capture-pocket-casts` and its recorded `add-bookmark-fork` dependency.
Classify pending tasks before archive. Do not archive this change before its task PR merges.

Luca approved implementation on 2026-11-02 by instructing work to continue after the proposal review request.
Prepare runtime evidence and human hands-on acceptance before opening the PR, as required by the repository.
