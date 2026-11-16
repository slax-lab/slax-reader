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
- Generate the readable podcast article and translations with up to five concurrent chunks, following the YouTube implementation.
- Preserve full transcript coverage, ordered assembly, retry reuse, and the episode cost limit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: recognize Pocket Casts short-code share links through their resolved episode destination.

## Impact

The implementation affects the API capture resolver, podcast article runner, prompts, and tests. It needs no dependency, API contract, database, or client package change.
The initial capture shows the existing player and notes. The existing workflow then generates the complete transcript article.
Web and API releases do not require package-version increments.

## Non-goals

This change does not enable Labs, replace annotated bodies, introduce a new player, or automatically recapture stored bookmarks.
It does not change transcript providers or spending limits.

## Sequencing and review

PR #406 merged as `89fbf35e`; this change follows its implementation.
Archive this delta after `capture-pocket-casts` and its recorded `add-bookmark-fork` dependency.
Classify pending tasks before archive. Do not archive this change before its task PR merges.

Luca approved implementation on 2026-11-02 by instructing work to continue after the proposal review request.
Luca later directed the author to finish the code and request colleague deployment to `dev` for testing.
This task-specific instruction defers full runtime verification and human acceptance until the colleague deploys the change.
It does not claim that the local player preview passes transcript acceptance.

Luca requested readable articles after transcription and explicitly required concurrent generation based on the YouTube code.
This scope extension preserves the existing article editor and adds bounded concurrency with safe accounting.

Luca rejected the excerpt preview and requested the complete generated article in the YouTube reading presentation.
Reuse its introduction, contents, typography, topic headings, and chapter controls for podcasts.
Keep all paragraph cue references and playback behavior. Do not present edited excerpts as full workflow output.


On 2026-11-02, Luca accepted the complete raw-transcript guest page and requested PR submission.
This approval replaces the earlier submission deferral. It does not verify the generated article or translation.
The author records the remaining live-generation gaps in `validation.md` for human review.

Luca subsequently confirmed that he reviewed the UI-visible presentation in PR #469 and that it meets his requirements.
This 2026-11-02 confirmation resolves the pending presentation acceptance record; live-generation verification remains separate.
