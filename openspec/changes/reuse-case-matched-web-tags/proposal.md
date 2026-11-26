# Offer an existing tag when only letter case differs

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

BookmarkTags uses case-sensitive equality, so typing rust can offer creation even when Rust is already available.

## What Changes

- Match existing tag candidates case-insensitively and preserve their display spelling. Prefer attaching an existing tag over creating a case variant.
- When Rust and RUST already exist and the reader enters a case-equivalent query, both existing identities can be distinguished and selected, and neither is implicitly merged or newly created.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bookmark-tag-presentation` — Offer an existing tag when only letter case differs.

## Impact

apps/web/app/components/BookmarkTags.vue and its local and REST tag-selection paths.

Sequence after clarify-web-tag-confirmation for bookmark-tag-presentation.

[BookmarkTags.vue](../../../apps/web/app/components/BookmarkTags.vue)
