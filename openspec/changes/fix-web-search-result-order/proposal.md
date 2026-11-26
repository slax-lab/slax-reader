# Keep search results attached to the active query

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

In a Chrome component run, a failed Images search retained Rust rows. A late Rust success also replaced three JavaScript results with two Rust results under the JavaScript heading.

## What Changes

- Keep rows, count, loading and errors tied to the latest search. Provide an in-place retry for the current input.
- When Images fails after a successful Rust search, the Images input remains editable, Rust rows and count disappear, and retry runs Images.

## Capabilities

### New Capabilities

- `web-library-search` — Keep search results attached to the active query.

### Modified Capabilities

None.

## Impact

apps/web/app/components/BookmarkList/SearchHeader.vue and its existing component tests.

First of the three web-library-search proposals. The retrieval and ranking contract remains owned by owned-bookmark-search-filtering.

[SearchHeader.vue](../../../apps/web/app/components/BookmarkList/SearchHeader.vue)
