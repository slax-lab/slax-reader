# Expose library search at narrow widths

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The shared top-bar search is hidden at widths up to 860px. This makes a frequent library action difficult to reach in a phone browser or embedded Web view.

## What Changes

- Expose a labeled compact search action at the narrow breakpoint and reuse the existing search input and results flow.
- When the reader navigates with a keyboard at 320px, 860px and just above the breakpoint, one search entry is reachable, it has an accessible name, and dismissal restores usable focus.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-library-search` — Expose library search at narrow widths.

## Impact

apps/web/app/components/BookmarkList/BookmarksSearchBar.vue and BookmarksTopBar.vue.

Sequence after scope-web-search-history; use the same search surface and history policy.

[BookmarksSearchBar.vue](../../../apps/web/app/components/BookmarkList/BookmarksSearchBar.vue) · [BookmarksTopBar.vue](../../../apps/web/app/components/BookmarkList/BookmarksTopBar.vue)

## Demo approval

On November 25, 2026, the change requester approved the interactive Web demo for compact search entry, submission and keyboard dismissal and authorized implementation as shown.
