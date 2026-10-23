# Tasks

## 1. Port the image-sizing correction

- [x] 1.1 Port the legacy processor change and focused regression tests into the two mapped Web files, using English for new comments and test names; verify the oversized-image test fails before the processor change and passes afterward.
- [x] 1.2 Verify fitting images, high-resolution icons, percentage widths, automatic heights, non-WeChat articles, PhotoSwipe, container shrink, zero-to-positive width, missing ResizeObserver, and cleanup through focused unit tests; retain existing image load and preview regressions.

## 2. Validate and prepare the implementation PR

- [x] 2.1 Run the Web article processor and article integration tests, Web lint and typecheck, and `openspec validate --all --strict`; record actual results and any baseline failures without using legacy test results as v2 evidence.
- [x] 2.2 Verify the actual image processor and article styles in a browser at narrow mobile, the 768px transition, and desktop widths across light, dark, and e-ink; record proportional oversized images, unchanged icons, and resizing behavior.
- [x] 2.3 Run the Bugs, Security, and Compliance pre-push review from `REVIEW.md` against `sync-wechat-image-sizing`, resolve Important findings, and update this branch's PR targeting `dev` with the implementation and validation results.
