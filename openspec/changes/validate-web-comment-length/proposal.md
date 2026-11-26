# Explain the comment length limit before submission

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The reader keeps Send enabled at 1,501 characters while the existing write contract rejects values longer than 1,500 UTF-16 units. Queue blockage is a historical observation and has not been reproduced on this release.

## What Changes

- Show a localized length error and block invalid new comments and replies before either local or direct submission. Retain the draft for correction.
- When the reader shortens the draft to exactly 1,500 units and submits, the valid comment can be saved and a subsequent valid edit proceeds.

## Capabilities

### New Capabilities

- `web-reader-comment-entry` — Explain the comment length limit before submission.

### Modified Capabilities

None.

## Impact

apps/web/app/components/Snapshot/SnapshotCommentComposer.vue and article selection comment input paths.

No existing queued-data repair is assumed. Validate both local-first and REST writers.

[SnapshotCommentComposer.vue](../../../apps/web/app/components/Snapshot/SnapshotCommentComposer.vue) · [ArticleCommentInput.ce.vue](../../../apps/web/app/components/Article/Selection/ArticleCommentInput.ce.vue)
