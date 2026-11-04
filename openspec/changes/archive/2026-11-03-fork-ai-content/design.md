# Design

## Context

See proposal.md for the reproduced defect. `copyHtml` currently evaluates `document.querySelector('article') || document.body || document.documentElement`. LinkeDOM provides an empty synthetic body for a div fragment; the truthy body prevents the final branch from reading visible text. Ordinary capture persists `contentDocument.documentElement.outerHTML`, so fragments are supported production input. Existing bundle tests only use article fragments.

Chat resolves its input through `BookmarkService.getBookmarkTitleContent`; outline and overview read their text through `BookmarkService.getBookmarkContent`. Both paths converge at the latter read boundary. The current copy writes a valid text key with an empty object, so changing future publication alone leaves affected copies broken.

## Goals / Non-Goals

Recover text consistently across future copies and the reproduced historical empty-text state. Do not introduce a migration, background repair job, write-on-read mutation, new retry system, source refetch, or frontend change. Missing text objects are outside the reproduced empty-object defect and keep their existing behavior.

## Decisions

1. Share a small saved-HTML text extractor between copy publication and empty-text reads. Retain article priority; otherwise read the document's element/text children after removing scripts, styles, noscript and head content. Ignore comments and document declarations. Do not select a body: historical publication can serialize an empty synthetic body before visible content in both div fragments and bodyless html-root documents. Cover div, article, main, sibling fragments, complete documents, published fragment/bodyless-document re-Forks, and recovery with real publication markers in tests. Reusing the source text object was rejected because it can be stale relative to the copied HTML.
2. At the existing shared content-read boundary, preserve nonempty text verbatim. Only an empty object with a conventional `text/body/<uuid>.txt` key qualifies for derivation from `html/body/<uuid>.html`. Keep PDF and arbitrary legacy keys unchanged. Return derived text without persisting it. This uses the same destination UUID and cannot follow provenance into another owner's content.
3. Preserve existing access/moderation checks before generation. Keep existing missing/empty outcomes when the saved destination HTML cannot provide text. Do not catch storage exceptions as empty content.
4. Keep capability deltas separate from the unarchived creation/provenance and outline-format changes: this change owns `snapshot-ai-text` only.

## Risks / Trade-offs

- Empty historical objects require one extra HTML read per AI input read until the owner refreshes the copy. This is confined to the reproduced broken state and avoids a storage migration or new write races.
- Local reproduction has not inspected the user's particular production record. Verify the matching failure path and three consumers with fixtures; report any remaining production/provider validation gap explicitly.
- Extracted plain text preserves current concatenation semantics; improving paragraph formatting is outside this fix.

## Migration Plan

Deploy the API change through the normal branch flow after approval, implementation, and verification. Existing empty copies recover on read; future Forks publish usable text. Rollback reverts API code without changing database or object layouts.
