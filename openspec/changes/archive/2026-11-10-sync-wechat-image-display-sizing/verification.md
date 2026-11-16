# Verification

Verified on 2026-10-13 in the isolated `fix/sync-wechat-image-display-sizing` worktree, based on `7bf86900`. The user approved the proposal before implementation. The main checkout and its unrelated edits were not changed.

## Source fidelity

Ported frontend #1619 at `e440517f7c73a9e5677b38390f9e95316b4b8ec4` and backend #871 at `9712dca21f5b97c691fe77e246c628623ddd4ab6`. The Web port retains v2's animation-frame resize scheduling and cleanup. Local review additionally identified and corrected two source-helper regressions: case-sensitive custom-property names and the order of duplicate declarations relative to shorthands. No dependencies or generated tracked artifacts changed.

## Automated validation

| Check | Result |
| --- | --- |
| API source regression suite before implementation | 22 failed, 1 passed, reproducing lost dimensions and fixed heights |
| Web image suite before implementation | 10 failed, 29 passed, reproducing icon enlargement, lost maximum constraints, and flattened frames |
| API review regressions before corrections | 3 failed, 23 passed |
| `pnpm --filter @apps/slax-reader-dweb test --maxWorkers=2` | 2020 passed, 1 skipped across 190 files; includes 39 image processor tests and article integration tests |
| `pnpm api -- test` after final review corrections | 1903 passed, 46 skipped across 167 files; includes 26 image collection tests using actual Readability |
| Web and API typecheck | Passed |
| `pnpm api -- lint` | Passed with 336 existing warnings |
| Changed Web/API implementation ESLint | Passed |
| Changed-file Prettier checks | Passed; Web checked using the matching formatting options in `apps/api/.prettierrc.mjs` because Web has no standalone Prettier configuration |
| `pnpm --filter @apps/slax-reader-dweb lint` | Existing baseline: 89 errors and 364 warnings; all 89 files with errors are byte-identical to the base commit |
| `pnpm exec openspec validate --all --strict` | 37 passed, 0 failed |
| `git diff --check` | Passed |

Web commands used synthetic localhost configuration. The initial broad API run could not resolve generated Prisma clients in the fresh worktree; `pnpm api -- gen:model` with dummy local database URLs generated them, after which the complete suite and typecheck passed. No database migration or deployment ran. One review regression initially used linkedom's camel-case-normalizing custom-property getter; it now checks the serialized HTML, and the real browser check independently verifies the resulting 14px width.

## Browser validation

Chrome `155.0.8059.40`, using API pre-processing → installed Readability → API post-processing output, then the actual Web image processor. Both style blocks from `BookmarkArticle.vue` were compiled with Web UnoCSS directives and production theme CSS. Synthetic raster fixtures provide known intrinsic dimensions. This tests collection-to-rendering integration locally, not an authenticated live capture service.

All 12 cases passed: light, dark, and e-ink at viewport widths 360, 768, and 1440px, plus desktop-to-mobile resizing in each theme. Assertions cover a parent-constrained 500×571 icon, a 96px bitmap displayed at 14px, a 2490×1148 image, height-only sizing, an explicit crop, relative width, tighter maximum width, historical oversized markup, maximum-only sizing, CSS variables, and shorthand/longhand ordering. No window error events occurred. Screenshots were inspected across the three themes and at mobile, the primary transition, and desktop.

Representative measurements (all themes matched):

| Viewport | Article width | Large image | Parent-constrained icon | Crop |
| --- | --- | --- | --- | --- |
| 360px | 328px | 328 × 151.22px | 14 × 15.98px | 328 × 100px |
| 768px | 736px | 736 × 339.33px | 14 × 15.98px | 736 × 100px |
| 1440px | 772px | 772 × 355.92px | 14 × 15.98px | 772 × 100px |

The custom-property fixture renders at 14px, and duplicate longhands retain computed margin-left and padding-left of 10px. Existing unit tests cover observer disposal, canceled pending frames, zero-width measurement, and missing ResizeObserver.

## Pre-push review

An independent reviewer performed REVIEW.md's Bugs, Security, and Compliance passes against `sync-wechat-image-display-sizing`. Both Important findings were reproduced and fixed before push. Re-review found no remaining Important findings or Nits and independently checked variables, margin, padding, border, and important declaration ordering through Readability. The reviewer did not rerun the broad suites or browser checks.

Release Web before API if deployed separately. The Web fix benefits existing stored content at rendering; backend normalization applies when collecting or recapturing. No stored-content migration is included. Archive this change only after merge.
