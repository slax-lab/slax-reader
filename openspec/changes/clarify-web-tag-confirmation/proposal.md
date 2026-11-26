# Clarify what the tag confirmation button counts

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

After attaching a tag and reopening its menu, the button says Done (0). Its number counts pending additions while checkmarks include previously attached tags.

## What Changes

- Label the idle action Done and label pending additions with their count. Keep existing tags visibly attached.
- When the reader selects two more tags and confirms, the control describes two additions and reopening shows all three attached.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bookmark-tag-presentation` — Clarify what the tag confirmation button counts.

## Impact

apps/web/app/components/BookmarkTags.vue and Web locale messages.

First of the two bookmark-tag-presentation proposals.

[BookmarkTags.vue](../../../apps/web/app/components/BookmarkTags.vue)
