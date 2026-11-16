# Proposal

## Why

Pocket Casts episode links currently save as normal pages. The reported bookmark contains episode notes instead of a player and transcript article.

## What Changes

- Recognize Pocket Casts episode links on `pca.st` and `pocketcasts.com`.
- Extract the episode audio and metadata from the rendered episode page.
- Use publisher transcript links when the page advertises a supported timed format; otherwise use the existing transcription process.
- Reuse owner-initiated URL saving for recovery of old page captures. Preserve existing bookmark identity and annotation protection.
- Keep Labs opt-in, budgets, shared episode identity, and URL safety checks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: Pocket Casts episode capture and explicit recovery of old page captures.

## Impact

The podcast source parser, crawl service, and capture tests change. No new dependency, database migration, or Web layout is required. Deploy after the media response-header fix for browser access to podcast status.

## Approval and boundaries

Luca approved the proposed fixes on 2026-10-27 and requested planning and implementation. This implements the second proposal. Archive the already-merged bookmark-fork podcast deltas before this change.

## Non-goals

Do not import whole Pocket Casts libraries, copy authentication, enable Labs automatically, or treat an HTML transcript link as timed transcript data.
