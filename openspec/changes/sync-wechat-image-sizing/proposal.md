# Proposal

## Why

WeChat articles can retain oversized inline pixel dimensions, leaving an excessive fixed height when the reader constrains their width. Legacy frontend PR [#1616](https://github.com/unnoo/slax_reader_frontend/pull/1616) fixes this at render time, but the fix is absent from v2.

## What Changes

- Port the image-sizing fix from legacy commit `1328ba97a29f98d519fe1fac282c64cb3c721791` into the Web article image processor.
- Adapt oversized WeChat images with fixed pixel width and height to the available article width before image loading, and recheck when the article container resizes.
- Preserve other inline styles and existing behavior for fitting images, small icons, percentage widths, automatic heights, non-WeChat articles, and PhotoSwipe content.
- Port the focused regression tests and verify observer cleanup and delayed container measurement.

### Source audit

Audited on 2026-10-13: legacy `unnoo/slax_reader_frontend` branch `develop`, after PR #1615's merge commit `fe08a146dfaff371ce7b0bd054bd3ceedaac91e2`, through `1c4caa7f`.

| Commit | Date (Asia/Shanghai) | Classification |
| --- | --- | --- |
| `1328ba97` | 2026-10-10 23:39 | The only new code change: constrain oversized WeChat article images. Port its processor and tests. |
| `1c4caa7f` | 2026-10-10 23:41 | PR #1616 merge commit; no separate feature to port. |

V2 baseline: `origin/dev` at `c840c2e`. Both target files are byte-identical to the legacy files at the #1615 merge point. The earlier locale synchronization work is outside this audited range and this change.

## Capabilities

### New Capabilities

- `article-image-sizing`: Responsive sizing of oversized fixed-dimension WeChat article images without changing unrelated image presentation.

### Modified Capabilities

None.

## Impact

Implementation is limited to `apps/web/app/components/Article/processors/image.processor.ts` and its existing unit test file. No API, database, capture pipeline, package dependency, Extension, or theme-token change is required. Existing saved articles benefit when rendered without being captured again. Work takes place in a separate worktree on `fix/sync-wechat-image-sizing`, targeting `dev`.
