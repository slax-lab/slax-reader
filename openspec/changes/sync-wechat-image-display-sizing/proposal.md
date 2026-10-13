# Proposal

## Why

V2 already includes the oversized-image fallback from legacy frontend PR #1616, but WeChat icons can still expand to their bitmap width after loading, and newly collected articles can retain fixed bitmap heights. Port the complementary frontend #1619 and backend #871 fixes so collection and rendering both preserve intended display sizes.

## What Changes

- Preserve existing WeChat image width, height, and meaningful maximum-size constraints when small assets load; keep the existing intrinsic-width fallback for images without a display size.
- Exclude explicit `object-fit` frames from the historical fixed-dimension proportional-resizing fallback, retaining v2's animation-frame scheduling and observer cleanup.
- Normalize WeChat image styles around Readability extraction: retain author and parent-constrained widths, make ordinary images responsive with automatic height, and preserve height-only sizing, relative dimensions, tighter maximum widths, and intentional frames.
- Port regression coverage against the actual installed Readability and Web processor, adapting paths and new comments/test names to v2 conventions.

### Audited sources

Both source PRs were open when inspected on 2026-10-13. Port these pinned heads; do not merge the source PRs or silently include later changes.

| Source | Commit | V2 destination |
| --- | --- | --- |
| [Frontend #1619](https://github.com/unnoo/slax_reader_frontend/pull/1619) | `e440517f7c73a9e5677b38390f9e95316b4b8ec4` | `apps/web/app/components/Article/processors/image.processor.ts` and its tests |
| [Backend #871](https://github.com/unnoo/slax_reader_backend/pull/871) | `9712dca21f5b97c691fe77e246c628623ddd4ab6` | `apps/api/src/utils/parserUtils/processWeixin.ts`, new style helper, and collection tests |

## Capabilities

### New Capabilities

- `wechat-image-display-sizing`: Preserve intended WeChat image display constraints through collection and image loading, including responsive ordinary images and intentional frames.

### Modified Capabilities

None. The earlier `article-image-sizing` change was merged as #204 and remains unarchived; this sequential follow-up adds collection and load-time constraint handling without carrying a competing delta for that capability.

## Impact

Web article rendering and API WeChat extraction only. No dependency, schema, public API, theme-token, or Extension changes. Existing saved articles benefit from the Web compatibility fix; collection normalization applies to newly collected or explicitly recaptured content and does not migrate stored articles. Prefer releasing Web before API. Implement on `fix/sync-wechat-image-display-sizing` from `origin/dev`, then create one PR targeting `dev`.
