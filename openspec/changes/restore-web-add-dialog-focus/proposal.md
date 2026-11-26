# Return keyboard focus when the Add dialog closes

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The audit observed focus on body after Escape from Add at 390 × 844. The closing handler hides the dialog without restoring the invoking control.

## What Changes

- Return focus to the specific opener after dismissing the Web library Add dialog.
- When the dialog is opened from another available launch control and cancelled using its close button, focus returns to that opener and the next Tab follows the surrounding order.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `content-addition` — Return keyboard focus when the Add dialog closes.

## Impact

apps/web/app/components/BookmarkList/AddUrlTopModal.vue, BookmarksPage.vue and their launch controls.

Sequence after add-content-tabs establishes the content-addition capability.

[AddUrlTopModal.vue](../../../apps/web/app/components/BookmarkList/AddUrlTopModal.vue) · [Add dialog change](../../../openspec/changes/add-content-tabs/proposal.md)
