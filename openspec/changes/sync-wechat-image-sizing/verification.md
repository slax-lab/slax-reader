# Implementation verification

Verified on 2026-10-13 in an isolated worktree for `fix/sync-wechat-image-sizing`, after merging `origin/dev` at `b086da9`. The main checkout was not modified.

## Implementation

Ported legacy frontend commit `1328ba97` (PR #1616) into the Web image processor and its regression tests. Oversized fixed-pixel WeChat images become responsive before loading and when the article narrows. Existing saved articles benefit on rendering; recapture is unnecessary.

Browser validation found that the source's synchronous resize callback emits a deferred ResizeObserver notification warning when changing image height also changes container height. The v2 implementation coalesces those corrections into an animation frame and cancels pending work during disposal; initial correction remains synchronous. This follows the [MDN ResizeObserver guidance](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors). Expected-size guards and CSS container queries were also considered; frame deferral fixes the notification cycle without changing eligibility or article styles.

## Automated checks

Commands ran with synthetic localhost configuration and no local secret files.

| Check | Result |
| --- | --- |
| Regression tests before the port | 4 failed, 21 passed; reproduced retained oversized dimensions and missing resize handling |
| Frame scheduling regression before the scheduling fix | 2 failed, 23 passed |
| `pnpm --filter @apps/slax-reader-dweb test tests/unit/components/Article/processors tests/integration/components/Article` | 148 passed across 18 files, including all 25 image tests |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | Passed; final code also passed `vue-tsc --noEmit -p .nuxt/tsconfig.app.json` |
| ESLint on the changed processor and its test file | Passed |
| `pnpm --filter @apps/slax-reader-dweb lint` | Existing baseline: 91 errors and 365 warnings; every file with an error is unchanged from `origin/dev` |
| `pnpm exec openspec validate --all --strict` | 35 passed, 0 failed |
| `git diff --check` | Passed |

One intermediate test run overlapped Nuxt type generation and failed before collecting tests because the generated tsconfig was temporarily unavailable. Re-running after generation completed passed; final type validation used the existing generated configuration.

## Browser checks

Chrome `155.0.8059.40`, using the actual image processor, both compiled style blocks from `BookmarkArticle.vue`, the Web UnoCSS configuration, and production theme CSS. This was a local synthetic article fixture, not an authenticated live article or capture-service test. Fixture images have known intrinsic dimensions so proportional rendering can be asserted precisely.

All 20 browser cases passed:

- Light, dark, and e-ink at viewport widths 360, 767, 768, 769, and 1440px.
- Desktop-to-mobile resize and observer disconnection in each theme.
- Initially hidden content becoming visible, and initial correction without ResizeObserver.
- Full width and intrinsic aspect ratio for the oversized image; retained margins and border radius; unchanged 24px icons backed by 1080px assets; fitting 600px images preserved until narrowing.
- No window error events after the animation-frame adjustment, including no deferred ResizeObserver notification errors.

Representative light-theme measurements (the other themes matched):

| Viewport | Article width | Oversized image after loading | Icon | Initially 600 × 300 image |
| --- | --- | --- | --- | --- |
| 360px | 328px | 328 × 151.23px | 24 × 24px | 328 × 164px |
| 768px | 736px | 736 × 339.38px | 24 × 24px | 600 × 300px |
| 1440px | 772px | 772 × 355.97px | 24 × 24px | 600 × 300px |

Screenshots were inspected at narrow mobile, the primary transition, and desktop across the three themes. The processor's existing behavior for non-WeChat articles, PhotoSwipe, small-image load handling, and image previews remains covered by the unit suite.

## Review

Independent local Bugs, Security, and Compliance review of the final processor, tests, and design found no Important findings or Nits. The matching change is `sync-wechat-image-sizing`. Validation results above were run by the implementing agent; the reviewer did not repeat them. Archive this change only after merge.
