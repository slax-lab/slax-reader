# Tasks

## 1. Build index

- [x] 1.1 Write `/_nuxt/build-assets.json` listing every file under `_nuxt/` (except the two indexes) with its SHA-256, from the existing Nitro `compiled` hook after the PowerSync index. Verify with a tooling unit test on a fixture directory (sorted paths, digests, excluded indexes, rejected paths and extensions) and with `pnpm web -- build`, checking the index lists all 407 emitted files and that every digest matches.

## 2. Release retention

- [x] 2.1 Extend retention in `tooling/powersync-retention.mjs` to read each selected deployment's `build-assets.json`, download listed files with bounded concurrency, reject HTML, wrong types, and digest mismatches, and merge them with the existing conflict rules, keeping PowerSync recovery unchanged. Verify with unit tests: files from two earlier deployments are retained; a current file is never overwritten; disagreeing snapshots drop the path with `historical-conflict`; a missing index warns `missing-build-index`; an HTML or redirect response warns and is not written; files from deployments outside the window are not retained.
- [x] 2.2 Add build-asset rows and per-deployment coverage to the release summary. Verify with a unit test on `formatRetentionSummary` and by keeping the existing summary tests passing.
- [x] 2.3 Keep `tooling/web-pages-deploy.mjs` calling one retention entry point. Verify with the existing deploy tests and `pnpm test:ci`.

## 3. Verification

- [x] 3.1 Run tooling tests, Web `typecheck`, `pnpm web -- test`, and `openspec validate --all --strict`.
- [ ] 3.2 After the change merges to `dev`, check two consecutive test releases: the first warns `missing-build-index` and retains PowerSync assets; the second reports earlier deployments fully recovered and retained build assets. Then load an entry chunk that only the earlier deployment emitted from `r.slax.dev` and confirm it returns JavaScript, not HTML. Record results in `validation.md`.
- [x] 3.3 Complete the local `REVIEW.md` review before the pull request.
