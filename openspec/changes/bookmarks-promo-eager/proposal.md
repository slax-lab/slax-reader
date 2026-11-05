# Proposal

## Why

The bookmarks sidebar promotion is inserted only after account and eligibility checks, then additionally uses native lazy loading. Remove the avoidable post-insertion wait for its desktop presentation without changing the preceding startup or API flow.

## What Changes

- Use eager loading for both localized promotion images at the existing desktop sidebar breakpoint (at least 921 CSS pixels).
- Preserve lazy loading at narrower widths, where the promotion is hidden, and leave request priority at the browser default.
- Preserve all eligibility, account, KOC, locale, source, sizing, and click behavior.

## Capabilities

### New Capabilities

- `bookmarks-promotion-image-loading`: Desktop promotion loading after existing eligibility gates.

### Modified Capabilities

None. Existing onboarding and article-image policies are unchanged.

## Impact

Only `apps/web/app/pages/bookmarks/index.vue` runtime behavior changes. Reuse the installed VueUse media-query helper. No new dependency, API, instrumentation, preload, or article-page change.

## Human review

On 2026-11-02, the user explicitly selected the previously proposed desktop `loading="eager"` change with normal request priority and deferred the other bookmarks suggestions. This records that conversational approval. The implementation follows the existing 921px sidebar breakpoint to keep hidden narrow-screen images lazy. This is a local loading-policy change, not a material UX redesign.

On the same day, the user requested delivery on existing PR #449 rather than a separate promotion branch. The capability remains separate from the article policy delta.
