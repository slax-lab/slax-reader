# Validation

## Scope

Release tooling only: the Web build writes `/_nuxt/build-assets.json`, and the release helper retains earlier deployments' `/_nuxt/` files. No application runtime, API, data, or UI change; Web does not use package-version increments (`docs/release/VERSIONING.md`).

## Problem evidence (before the change)

- Pages answers a missing `/_nuxt/` file with the HTML shell and status 200: on `r.slax.dev`, `/_nuxt/wa-sqlite-async-CXmNm_EE.js`, `/_nuxt/definitely-missing.js`, `/_nuxt/missing.wasm`, and `/_nuxt/missing.css` all returned `200 text/html`.
- Comparing two test deployments a few releases apart, 25 of the earlier one's entry files are absent from the newest build, and 7 of those now return HTML from `r.slax.dev`.
- Until the test project's Access policy was removed on 2026-11-20, every earlier deployment address answered `302` to `slax-test.cloudflareaccess.com`, and the `dev` release (run 44693801170) and the latest `beta` release (run 44457355313) logged `download-unavailable` for every deployment and retained nothing. After the change requester removed it, all checked test deployment addresses return `200 application/json` for `/_nuxt/powersync-assets.json`. The beta and production projects were opened the same way later that day; the three most recent deployment addresses of each (`slax-reader-frontend`, `slax-reader-frontend-beta`) return `200 application/json` for the same file.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm test:preflight` (includes the new `tooling/build-assets.test.mjs` and the extended `tooling/powersync-retention.test.mjs`) | 148 passed, 2 skipped, 0 failed |
| `SLAX_TEST_PAGES_BUILD=1 node --test --test-name-pattern "actual Nuxt output" tooling/web-pages-deploy.test.mjs` (real build through the offline publication path) | passes |
| `pnpm test:ci` | 82 passed |
| `node --test tooling/ci-scope.test.mjs` (build asset helpers select the Web build, like the PowerSync helpers) | 12 passed |
| `openspec validate --all --strict` | 163 passed |
| `eslint apps/web/nuxt.config.ts` | passes |

New tests cover: the index lists every emitted `/_nuxt/` file sorted with its digest and excludes `/_nuxt/builds/` and both indexes; an unexpected extension or empty file fails the build; paths outside hashed `/_nuxt/` assets and malformed or duplicated indexes are rejected; content types must fit the extension; files from two earlier deployments are retained; a current file is never replaced and disagreeing snapshots drop the path; HTML, wrong types, digest mismatches, and redirects are skipped while verified siblings are kept and PowerSync coverage is unaffected; an index naming paths outside `/_nuxt/` or mutable metadata is rejected without requesting them; deployments outside the window are not retained; the summary reports current and retained build assets separately; and a current build without its index fails before upload. The existing three-release test now also asserts that deployments without an index report only `missing-build-index`.

`tooling/web-pages-deploy.test.mjs` "interrupted publication cleans the entire staging directory" fails when run alone with `--test-name-pattern` on `origin/dev` as well (an `AbortError` message mismatch); it passes in the full suite.

## Build output

A `preview` build (`pnpm build` with `SLAX_ENV=preview`) wrote `/_nuxt/build-assets.json` (45,470 bytes) listing 404 files; every file under `_nuxt/` except `builds/` and the two indexes is listed, and every digest matches the file on disk.

## Retention runs

- Against the test project's real deployment list (25 production deployments, Access removed), the release preparation recovered PowerSync resources for all 25 (`fully recovered: 25`, previously 0) and reported build asset coverage `unknown` with only `missing-build-index` warnings, because those deployments predate the index. This is the expected first-release behavior.
- Running the code before and after this change on that same list and the same staged build produced byte-identical staging directories (825 files, same aggregate digest), identical PowerSync counts, and no PowerSync warnings, so PowerSync retention is unchanged.
- Second-release simulation: build A (with its index) was served as an earlier deployment and build B (a source change) was prepared for release. All 97 files only A emitted were retained into B's staging directory with no warnings; the summary reported `Added historical build assets | 97 | 6538859`.

## Pending after merge

Task 3.2: the first `dev` release after merge should warn `missing-build-index` and retain PowerSync resources; the second should report earlier deployments fully recovered with retained build assets, and a chunk only the earlier deployment emitted should load from `r.slax.dev` as JavaScript. The same should then hold for the next beta and production releases.

## Local review

The deploy-helper fixtures failed 19 tests until they gained a current `build-assets.json`, confirming a release without its own index stops before upload.


`REVIEW.md` Bugs, Security, and Compliance passes on the final diff found no Important issue. Fixed during review: the shared merge now records the owning deployment and kind in one place for both PowerSync and build assets; historical-conflict warnings on build assets carry `kind: build` so they do not lower PowerSync coverage; and the summary gained the "Current build assets" row the delta spec requires, read from the current build's own index, whose absence or digest mismatch stops publication. Security: index paths are confined to hashed files under `/_nuxt/` (`..`, `%2e%2e`, backslashes, empty segments, and queries are rejected); requests go only to each deployment's own `*.pages.dev` origin with `redirect: 'error'`, carry no credentials, and writes stay under the staging directory.
