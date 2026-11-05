# Proposal

## Why

`capture-pocket-casts` keeps an annotated body when an owner saves a Pocket Casts link again. Other podcast sources do not get this check. A recapture of an Apple Podcasts, Xiaoyuzhou, Spotify, or RSS link replaces the body with the player and show notes.

Usually the article is written back after capture with the same markup, so its highlights keep their anchors. One case loses highlights for good. A link saved as a page while podcast Labs was off can carry highlights on the page text. After Labs is turned on, saving the link again replaces that page with the podcast body. The highlights then point to text that no longer exists. This is the same failure that `capture-pocket-casts` fixed for Pocket Casts.

## What Changes

- Check for annotations before any podcast recapture fetches the page, not only for Pocket Casts.
- Keep the annotated body and release the capture as success, exactly as the Pocket Casts path does.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `podcast-article`: annotated-body protection on recapture covers every recognized podcast source.

## Impact

One condition in `apps/api/src/entry/edge/workflows/crawlWorkflow.ts` and one comment in `apps/api/src/domain/crawl.ts`. Workflow tests now cover Pocket Casts and Xiaoyuzhou. No API contract, dependency, migration, or user interface change. No packaged CLI, Extension, or Mobile code changes.

Trade-off, the same as for Pocket Casts: a bookmark with highlights cannot be converted to a podcast body by saving it again. The highlights must be removed first.

## Sequencing

The unarchived `capture-pocket-casts` and `add-bookmark-fork` changes also carry `podcast-article` deltas. This change adds a separate requirement and modifies none of theirs. Archive it after them.

## Approval

Luca approved splitting this fix out of PR #413 in conversation on 2026-10-31.
