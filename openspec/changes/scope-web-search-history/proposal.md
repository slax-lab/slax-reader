# Keep recent searches private to the active account

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The search bar stores five terms in one origin-wide key. An isolated Chrome run showed the prior terms after an identity change and reload.

## What Changes

- Restore history for the verified current account and clear the visible list immediately on identity changes.
- When A signs back in, clears recent searches and later returns to the same browser, A's saved terms are gone and B's history is unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-library-search` — Keep recent searches private to the active account.

## Impact

apps/web/app/components/BookmarkList/BookmarksSearchBar.vue and useAccountContext.ts.

Sequence after fix-web-search-result-order. The last successful login email is a separate specified convenience preference.

[BookmarksSearchBar.vue](../../../apps/web/app/components/BookmarkList/BookmarksSearchBar.vue)
