# Prevent whitespace-only bookmark titles

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The library list passes editingTitle directly to the local writer or REST mutation, and a spaces-only alias wins the display fallback.

## What Changes

- Reject whitespace-only renames with an inline explanation. Allow correcting the title without losing the previous one.
- When a reader supplies a valid replacement after a rejected rename, the normal rename path accepts the corrected title.

## Capabilities

### New Capabilities

- `web-bookmark-title-editing` — Prevent whitespace-only bookmark titles.

### Modified Capabilities

None.

## Impact

apps/web/app/components/BookmarkList/BookmarkCell.vue and the editable reader title action.

Covers Web editors and display. The search index for aliases is outside this change.

[BookmarkCell.vue](../../../apps/web/app/components/BookmarkList/BookmarkCell.vue) · [useLocalBookmarks.ts](../../../apps/web/app/composables/bookmark/useLocalBookmarks.ts)
