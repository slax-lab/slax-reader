# Validation: trim-web-startup-bundles

## Current status: recovery fixed and exercised, 2026-11-10

The approved implementation is on `feat/lazy-load-bundle` (renamed from `perf/trim-web-startup-bundles` at the user's request). The user requested a PR and then explicitly directed the agent to continue fixing/testing the demonstrated recovery defect. Same-page repeated-failure recovery now passes real-browser tests through the scoped optional-resource preflight described in design.md. After the agent explained that Extension source/version were unchanged and recommended retaining 1.16.3, the user requested PR submission again. Proceed with Extension 1.16.3 unchanged and publish a draft PR as requested. Human hands-on acceptance has not been recorded and is not inferred from this submission request; the draft is not declared ready for merge. No deployment or archive is authorized.

### Integration with current dev

Before PR preparation, `origin/dev` advanced to `6016ee48` with login-startup optimization #557 and an unrelated documentation archive. The task branch was fast-forwarded after saving a recoverable local stash, then the feature changes were restored. The sole conflict was the manifest hook: retain upstream login preload collection, then run this change's database/optional-prefetch filters. No upstream login implementation was discarded.

The integrated source passed **2,776 tests (238 files), with 3 tests / 1 file skipped**, typecheck, and production build. Full lint remains **89 errors / 437 warnings**; strict all-spec validation now passes **124 items, 0 failed** after upstream spec additions. Both staged and unstaged diff checks pass. Real integrated login renders normally; article and collection SSR return 200 with their content. Optional panel/parser hints remain false, the demand-only index is absent on login startup, and Worker/WASM index is unchanged. The real integrated AI panel was deliberately failed once, retried to 200 and displayed its outline with no captured page errors.

The original-versus-repaired byte table below is a matched comparison on the original base; it must not be presented as incremental savings against the newly merged login optimization. No post-integration byte benefit is attributed to this task without a fresh matching target baseline. Integrated evidence lives in `.local/bundle-validation/integrated/`.

### Final repaired results

`retry-verified` is the final source build. Its static-closure gzip bytes are login **269,104** (original 268,155; +949), article **451,021** (original 921,763; -51.1%), collection **289,882** (original 313,432; -7.5%), library **372,931** (original 392,855; -5.1%). The demand-only generated dependency index is 3,056 raw bytes, loaded only when an optional interface is first opened. It is not requested on ordinary closed-panel article startup. Required Worker/WASM indexes remain unchanged. These figures supersede the pre-repair expanded numbers below; no fixed latency or Safari benefit is asserted.

- Final standard Web tests: **238 files passed, 1 skipped; 2,775 tests passed, 3 skipped**. Final typecheck and production build passed. Full lint remains 89 errors / 437 warnings, matching the unrelated baseline diagnostics. Strict OpenSpec validation: 121 passed / 0 failed. `git diff --check` passes.
- Tests cover the build index's exact JS/CSS closure, entry/renderer/stylesheet failures before import, invalid MIME/HTML fallback, failed index retry, request sharing, unchanged dev loading, panel draft retention, pending quotes, permission denial, account-generation invalidation, modal callback compatibility and duplicate prevention.
- On a fresh built-in-browser origin, AI entry JS, shared Markdown renderer JS and AI CSS were each deliberately failed twice. Server evidence for every resource is **503, 503, 200**. The third user attempt displays the real outline; the scenario has exactly one document request, no reload and no storage reset.
- LoginModal was separately failed twice through the real Save for later action. Each failure shows existing operation-failed feedback without a blank modal. The third action receives 200 and displays the real login dialog. The former Important recovery finding is resolved for these demonstrated resource-failure paths.
- The exact final build was then opened on port 4182 with no chunk transformations: ordinary anonymous article has zero optional-index/panel/parser/modal requests and no captured page errors.
- Real owner first-use quote: select text in the actual article, invoke the selection toolbar's Chat action before opening chat, and observe the selected text appear in the newly loaded real chat. Request logs show **zero chat POSTs** and no captured page errors. Draft preservation on tab switch/close/reopen was also exercised on the preceding byte-equivalent panel implementation.
- The synthetic `/v1/user/refresh` fixture was corrected from an incorrect profile payload to `{token}` before the final first-quote test. Product authentication/entitlement guards were not weakened. The overview fixture's ordinary-error-versus-stream discrepancy remains historical fixture evidence below, not a claimed product fix.
- Local final evidence is under `.local/bundle-validation/retry-verified/` (`comparison.json`, `quote-evidence.json`, lint/spec logs), `retry-complete-browser-reports.json` and `retry-final-browser-reports.json`. Only the HTML observation probe is injected for recording; final JS/CSS are unmodified production assets.

### Final local review

Bugs / Security / Compliance passes were repeated against the repaired source. No unresolved Important code finding remains for the exercised scope. Preflight checks are confined to exact generated optional-module dependency URLs and preserve the original module URLs/identity; failures are handled before import and remove only failed request promises. No credentials, new dependencies, remote endpoints, storage/schema changes, sync-policy changes or automatic reload were added. This is not an atomic guarantee against cache eviction or an outage between a successful preflight and evaluation; that limitation is documented in design.md.

Extension 1.16.3 is retained following the no-bump recommendation and the user-requested submission. Publication is explicitly draft-only until human hands-on acceptance of the new loading/retry UI is recorded. This user-directed early publication does not claim that the acceptance requirement has been satisfied. Remote initial library synchronization, production 499s, physical iOS Safari and paired extension bridge remain explicitly unverified. The user-requested branch name intentionally differs from the established OpenSpec change-id; retain `OpenSpec: trim-web-startup-bundles` in the PR.

## Historical expanded slice before recovery fix

The measurements and initially failing retry evidence below are retained as history. Their blocking status and totals are superseded by the repaired results above.

### Final production measurements

The identical locked production configuration and closure methodology below were reused. `slim-verified` is the current source build; `final` is the minimum slice before panel/modal deferral. Numbers are per-file gzip level-9 recompression, not CDN transfer or latency measurements.

| Route static closure | Original gzip bytes | Minimum slice gzip bytes | Expanded gzip bytes | Reduction from original | Expanded raw bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/login` | 268,155 | 268,143 | 269,104 | -949 (-0.35%; increased) | 763,430 |
| `/b/:id` | 921,763 | 921,742 | 450,497 | 471,266 (51.1%) | 1,422,427 |
| `/c/:id` | 313,432 | 313,420 | 289,368 | 24,064 (7.7%) | 821,730 |
| `/` / `/bookmarks` | 392,855 | 392,844 | 372,419 | 20,436 (5.2%) | 1,087,850 |

Expanded hint counts are login 37 prefetch / 41 modulepreload, article 20 / 75, collection 22 / 61, library shell 37 / 41. Prefetched gzip sums are 76,518, 46,835, 47,786 and 76,518 bytes respectively. Counts can rise for required modulepreloads after splitting without increasing their total byte weight. Worker index validation passes and is byte-equivalent to the original index. No synchronization or storage logic changed.

The optional UI hint collector uses real `generateBundle` module provenance for the eight named interface implementations, follows their static JS/CSS dependencies, and preserves the Nuxt entrypoint's required closure. It changes only prefetch metadata, never preload or import edges. Some dependencies are shared across optional surfaces; their actual-demand loading remains available. Opaque hash names are not used to infer source identity.

### Expanded-slice checks

- Final `test`: **237 files passed, 1 skipped; 2,768 tests passed, 3 skipped**.
- Final `typecheck` and production `build`: passed, including a rerun after fixing two new import-sort diagnostics.
- New/changed lazy-interface files pass targeted ESLint. Full lint retains **89 errors / 437 warnings**, matching the pre-expansion baseline counts; remaining touched-file diagnostics match HEAD. No unrelated lint cleanup.
- `openspec validate --all --strict`: **121 passed, 0 failed**. `git diff --check`: passed.
- Prior Extension typecheck, 108 tests and production build remain applicable: the expansion changes Web files only, not the shared text implementation since those checks. Extension version remains 1.16.3 pending the already-requested human decision.

### Actual built-in-browser exercise

The real production Pages Worker and synthetic backend ran on local ports 4173, then fresh origins 4177/4178 for failure isolation. The final verified artifact was used on fresh origins. The underlying PowerSync stream is intentionally unavailable; no real account secrets or production writes were used.

1. Ordinary anonymous article renders with no captured page error and **zero pre-use requests** for AI panel, chat panel, heavy Markdown parser, LoginModal, Feedback, EditTag or SnapshotStatusModal. SQLite still creates its database through the normal selected Worker/WASM path.
2. Clicking Save for later requests LoginModal only then, displays its real Google-login surface, and Close removes it. OAuth itself was not executed.
3. An article with a synthetic outline loads its AI panel/parser only after demand; the real Markdown heading "Fixture outline" displays. Existing automatic opening also still works.
4. An authorized synthetic owner opens Chat, enters a draft, switches to Analysis and back, then closes/reopens Chat. The exact draft remains. No `/v1/aigc/chat` POST occurs. Pending-first-quote, denied actions and account-generation invalidation pass unit tests; a real selection-menu quote was not exercised.
5. Final collection renders its real title, count and article link; final anonymous login renders normally. Complete authenticated-library initial sync remains an explicit gap because there is no test PowerSync stream.
6. A one-shot deliberate AI JS 503 is followed by a 200 request and the outline appears. With **two consecutive deliberate 503s**, the article remains readable and the deferred panel displays its retry control. After clicking Retry, **no new module request is issued** although an independent request to the same file returns 200. The error stays visible. This failed acceptance case is reproducible and is not excused by passing mocked unit tests.

A separate `Cannot use 'in' operator to search for 'done' in null` error was traced to the unchanged overview stream parser receiving the fixture's ordinary JSON error envelope. It reproduces in the minimum build (`tQG9VAou.js:292:772` via `Ci114ciE.js:1:20322`). The fixture was corrected to use real progress/done frames and cached outline records; the application parser was not changed. This is not claimed as an application fix.

Local evidence: `.local/bundle-validation/slim-verified/comparison.json`, `slim-browser-reports.json`, `slim-verified-browser-reports.json`, `slim-clean-browser-reports.json`, `slim-retry-browser-reports.json`, and the `smoke-slim.mjs` fixture. Production snapshots and probes remain gitignored.

### Expanded three-pass review and remaining work

- **Important — Bugs / Compliance:** `DeferredSnapshotPanel.vue` and `deferredModal.ts` call the same importer after failure; the browser can retain that rejected module load. The panel failure is confirmed live; the same mechanism puts modal recovery at risk. Tasks 3.2 and 4.2 are reopened. A passing retry with a mocked loader does not establish real browser retry. Do not ship or label these tasks complete.
- **Bugs:** normal activation, preserved draft state, original callback arguments, context propagation and demand-loading checks passed. No new data-schema, local ownership, upload or Worker policy was introduced.
- **Security:** no new dependency, remote network destination, secret access, stored-data deletion or authentication bypass in the application diff. Pending panel actions are scoped by the keyed page/account wrapper, with generation checked before deferred quote delivery.
- **Compliance:** the approved scope and measured benefits are implemented, but recoverability is not. No automatic reload was added because it could discard state elsewhere in the page; a reload-based fallback would need its state-preservation/UX policy explicitly reviewed. An in-document loader-level retry is a larger implementation decision and must cover failed dependencies, not merely append a query to the top-level entry.
- Real modal forced-failure recovery, physical iOS Safari, live remote sync, paired extension bridge and human hands-on acceptance remain outstanding. No PR will be opened before required acceptance.

## Historical minimum-slice status and scope

Implementation is present in `.local/web-bundle-minimal-worktree` on `perf/trim-web-startup-bundles`, based on `bbd8fbb3718f2786eea84ffc2ede90ff5de0de80`. The user approved the minimum implementation with "开始" and then requested continuation. No commit, push, pull request, deployment, archive, or production mutation was performed.

Only the five source-identified prefetch exclusions and the dependency-free text entrypoint were implemented. Database construction, sync policy, Worker selection, storage identities, pending writes, rendering features, service-worker caching and CDN settings are unchanged. The hook is source-specific, not route-specific: other Web documents referencing these same five alternatives receive the same hint correction. No global resource-hint disable or runtime feature switch was added.

The verified benefit is fewer speculative downloads. This is **not** a fix for every first-screen delay, Safari white screen, remote-sync wait or HTTP 499. Initial static dependency weight did not shrink in this build. Full authenticated-library synchronization and live fallback/extension-bridge acceptance remain unverified. An Extension version decision is outstanding; version 1.16.3 is unchanged.

## Reproducible build setup

Validation ran on 2026-11-10 using Node 22.23.1 and pnpm 11.25.0. Baseline, hint-only and final Web builds use the same lockfile and production profile, with synthetic non-secret configuration:

```sh
export SLAX_ENV=production
export PUBLIC_BASE_URL=http://127.0.0.1:4173
export AUTH_BASE_URL=http://127.0.0.1:4173
export SHARE_BASE_URL=http://127.0.0.1:4173
export DWEB_API_BASE_URL=http://127.0.0.1:4174
export COOKIE_DOMAIN=127.0.0.1
export COOKIE_TOKEN_NAME=slax_token
export GOOGLE_OAUTH_CLIENT_ID=example-client
export NUXT_TELEMETRY_DISABLED=1
pnpm --filter @apps/slax-reader-dweb... install --frozen-lockfile --prefer-offline
pnpm --filter @apps/slax-reader-dweb build
```

No secret configuration was copied into the worktree. Original production artifacts for all three stages are retained locally under `.local/bundle-validation/{baseline,hints,final}`; these are ignored evidence, not source changes. The scripts `verify-hints.mjs`, `compare-final.mjs` and `smoke.mjs` are in the same ignored directory. The base build was retained before application edits.

Vitest changed Nuxt's generated build directory from `apps/web/.nuxt` to `apps/web/node_modules/.cache/nuxt/.nuxt`; the correct manifest from each completed build was retained. Nuxt's intermediate `client.manifest.mjs` precedes the hook, so effective flags were checked in the built Worker `chunks/virtual/precomputed.mjs` and rendered HTML. Hash changes caused by generated paths are not treated as feature savings. Only the generated Nuxt paths-module identity was normalized when comparing unrelated hints.

## Production bundle comparison

Static closure means the deduplicated files reachable through `imports` and `css` from all manifest `isEntry` roots, `layouts/default.vue`, and the specified page. It excludes speculative prefetch and later dynamic demand loading. `/` uses the library page `pages/bookmarks/index.vue`; `/b` and `/c` mean their parameterized routes. Gzip is independent level-9 recompression of each output file, not measured CDN transfer. Minor gzip differences with identical raw totals reflect changed hashes/compression, not meaningful code removal.

| Route closure | Files before / after | Raw bytes before / after | Gzip bytes before / after | Raw reduction |
| --- | ---: | ---: | ---: | ---: |
| `/login` | 61 / 61 | 762,870 / 762,870 | 268,155 / 268,143 | 0 |
| `/b/:id` | 85 / 85 | 2,929,550 / 2,929,550 | 921,763 / 921,742 | 0 |
| `/c/:id` | 71 / 71 | 897,784 / 897,784 | 313,432 / 313,420 | 0 |
| `/` / `/bookmarks` | 85 / 85 | 1,155,481 / 1,155,481 | 392,855 / 392,844 | 0 |

The helper split establishes a clean import boundary but does not remove the Markdown/highlighting/rendering closure from these pages while other consumers still need it. The hint-only stage had exactly the same raw closure totals.

### Effective document hints

| Document / session | Prefetch before / after | Modulepreload before / after | Prefetch raw bytes before / after | Prefetch gzip bytes before / after |
| --- | ---: | ---: | ---: | ---: |
| `/login`, anonymous | 50 / 45 | 39 / 39 | 633,681 / 274,681 | 195,795 / 88,129 |
| `/b/bundle-public`, anonymous | 26 / 21 | 72 / 72 | 526,842 / 167,842 | 169,483 / 61,829 |
| `/b/bundle-public`, authenticated visitor | 26 / 21 | 72 / 72 | 526,842 / 167,842 | 169,483 / 61,829 |
| `/c/bundle-collection`, public | 30 / 25 | 62 / 62 | 530,111 / 171,111 | 171,114 / 63,462 |
| `/`, authenticated library shell | 50 / 45 | 39 / 39 | 633,681 / 274,681 | 195,795 / 88,129 |
| `/x/ext-bridge`, control | 50 / 45 | 39 / 39 | not summed | not summed |

Every sampled document returned HTTP 200. Article text and collection description were present in the actual SSR HTML before client execution. The five excluded files themselves are byte-identical across all three builds and total **359,000 raw bytes, 107,655 gzip bytes (105.1 KiB), or 94,410 Brotli bytes**. This is an avoidable speculative payload estimate when the browser honors prefetch, not an equivalent first-screen bundle reduction or a fixed latency gain. A legitimate later demand import may still download the same asset.

The exact identities are the four `@journeyapps/wa-sqlite/dist/{wa-sqlite,wa-sqlite-async,mc-wa-sqlite,mc-wa-sqlite-async}.mjs` modules and `@powersync/shared-internals/dist/websockets.mjs`. Their effective `prefetch` changes from true to false; `preload` remains true. The hint-only semantic HTML comparison removed exactly these five and added none. `validateCurrentAssets` passed for baseline, hint-only and final; the Worker dependency index is identical. No emitted database JS/WASM file was deleted or rewritten.

## Running-browser evidence

The Kimi Code Desktop built-in browser was used, not the user's Chrome/Edge session or a separate Chrome automation runner. The ignored smoke harness serves unchanged `dist` assets and runs the real Pages Worker through the installed Miniflare v5 v4-options adapter. Compatibility date `2026-05-26` and `nodejs_compat` match the repository. Baseline runs at `127.0.0.1:4175`, final at `127.0.0.1:4173`, and synthetic API responses at port 4174. Distinct origins isolate client caches and databases; cookies share the hostname, so the harness explicitly sets or clears the synthetic session before each session-dependent scenario.

The harness uses the repository's existing fixture pattern: synthetic BACKEND metadata, R2 article body and locally issued unsigned fixture token, with real SSR, hydration, imports and database initialization. The token is not valid against production. An HTML-injected read-only probe reports errors, resource timings and IndexedDB names at approximately 3 and 9 seconds; a local request log records purpose, destination and HTTP status. This probe does not change the production artifact. Static responses preserve generated `_headers`. The synthetic API intentionally refuses unimplemented endpoints and remote sync; it does not return fake success for every mutation.

### Observed outcomes

- **Anonymous login:** both versions render the same login screen. Around the 9-second probe, resource timing entries are 119 baseline versus 114 final. More importantly, the local server directly records all five target JS URLs with `purpose=prefetch` in baseline, and zero target requests in final. Neither login creates a database. This is the clearest isolated request-count benefit.
- **Anonymous article:** the real SSR title and paragraphs are visibly readable; final has no captured page errors. The selected SharedWorker, `wa-sqlite-async-C9Ag59MY.js`, and `wa-sqlite-async.zc68fxQq.wasm` return 200 with no prefetch purpose. IndexedDB `slax-reader-v3.db` version 6 is created. This confirms demand loading survives.
- **Collection:** title, description, count and article entry render. Clicking the entry opens the article successfully. No final page errors were captured for the public collection.
- **Authenticated visitor article:** a fixture session triggers the real user/profile flow; the article still renders with the account locale and no captured page errors. The visitor is not promoted to owner by the fixture. Remote sync-token calls are deliberately refused.
- **Authenticated home:** both baseline and final display the logged-in navigation and enter `Initializing… / Syncing your library to this device / Preparing…`. Both remain there because the fixture has no remote PowerSync service or initial synchronization checkpoint. This is **partial coverage, not a passed complete library interaction**. It also demonstrates that this minimum change does not remove the library's first-sync gate.
- **Bridge control:** `/x/ext-bridge` returns 200 with all 39 modulepreloads retained. Live extension pairing/session transport was not exercised; existing unit controls passed.

Additional approximately 9-second ResourceTiming entry observations were article 121 / 116, collection 108 / 102 and home 153 / 145 (baseline / final). These are navigation samples with warmed caches and different background API retry timing, not controlled cold-load performance comparisons; do not attribute every difference to this patch. Collection/home differences exceeding five are not claimed as savings. Server logs had no local resource 404s for either build. The login/home probe recorded the same unavailable Google Tag Manager resource and one non-specific resource error in both builds under synthetic configuration; these are not reported as new application exceptions.

No production transfer-size, median LCP, time-to-interactive, slow-network speedup or Safari fix is claimed. The local uncompressed HTTP fixture and one browser session cannot establish those numbers. Raw evidence is in `browser-reports.json`, `browser-summary.json`, `route-hints.json`, `bridge-document.json`, `hints/verification.json` and `final/comparison.json` under the ignored evidence directory.

## Automated checks

| Check | Result |
| --- | --- |
| Four focused Web test files: hint filter, text entry, parser, SnapshotAIPanel | 67 tests passed |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | Passed |
| `pnpm --filter @apps/slax-reader-dweb test` | 234 files passed, 1 skipped; 2,753 tests passed, 3 skipped |
| `pnpm --filter @apps/slax-reader-dweb build` | Passed for baseline, hint-only and final production stages |
| `pnpm --filter @apps/slax-reader-dweb lint` | Not green: final 89 errors and 437 warnings |
| ESLint current versus `git show HEAD:<path>` through the same `--stdin-filename` | All 8 touched/added Web files have identical rule/severity/message diagnostics to baseline; new files have zero diagnostics |
| `pnpm --filter @apps/slax-reader-extensions compile` | Passed |
| `pnpm --filter @apps/slax-reader-extensions test` | 25 files, 108 tests passed |
| `pnpm --filter @apps/slax-reader-extensions build` | Passed, production chrome-mv3; existing large-chunk warning remains |
| `pnpm exec openspec validate --all --strict` | 121 passed, 0 failed; existing informational notes remain |
| `git diff --check` | Passed |

The initial full lint attempt had two new import-sort errors in the added tests. Those were fixed and the final rerun has 89 errors / 437 warnings. The remaining touched-file diagnostics exactly match their untouched source at HEAD; other linted files were not modified. No unrelated lint cleanup was performed. The full lint command must not be represented as passed.

Extension checks used its locked dependency closure and `EXTENSIONS_API_BASE_URL=http://127.0.0.1:4174` with the same synthetic public URLs/cookie configuration. Its old `/parse` imports remain supported. No CLI or Mobile `/parse` consumers were found. The shared entry can affect Extension package output, so the human was asked whether to increment 1.16.3 to 1.16.4; no decision has been received and no version changed.

Existing Web full-suite controls include `powersync-worker-selection`, `powersync-worker-policy`, `powersync-recovery`, `powersync-public-startup`, `powersync-public-navigation`, `powersync-bridge-session`, and the `extensionBridge*` tests. These are automated regression controls, not substitutes for live fallback/synchronization testing.

## Three-pass local review

Change-id: `trim-web-startup-bundles`. Reviewed the complete tracked diff, new helper/tests, proposal, design, task state and delta spec under `REVIEW.md`.

- **Bugs:** no Important code findings. Source classification is exact; unknown and conflicting sources remain unchanged. Only prefetch metadata mutates. Required preloads, Worker resources and demand initialization were checked. Helper output fixtures and legacy function identity pass. Zero route-weight saving is explicitly reported.
- **Security:** no Important code findings. No new runtime dependency, network call, secret access, auth policy, database deletion or externally sourced code was introduced by the application diff. Text extraction is not treated as sanitization, and its existing entity/script-text behavior remains unchanged. Synthetic validation output stays local.
- **Compliance:** implementation matches the two approved slices and non-goals. No visual, accessibility, navigation, token or style change is intended, so there is no new design-acceptance claim. No PR is being opened; if the scheduling change is classified as UI-visible at PR review, human hands-on acceptance must precede opening it. Version confirmation and full library/fallback/bridge runtime coverage remain explicit open items. The change is not declared merge-ready.

## Remaining acceptance gaps

1. Complete initial library synchronization and subsequent reads/writes with a representative authorized test backend; the local fixture deliberately has no remote PowerSync data stream. Do not infer successful upload from database initialization.
2. Force supported fallback backends and verify pending CRUD preservation across upgrade/suspension in a live browser. Files/index and existing tests are unchanged/passing, but this run did not exercise those transitions.
3. Exercise real OAuth login, `/s` shared-reader flow, AI panel interactions and paired extension bridge. Unit tests and consumer builds cover their changed imports; real remote credentials and services were not used.
4. iOS Safari/physical-device behavior and production HTTP 499 were not retested; the user deferred that investigation in favor of minimum bundle work.
5. Obtain the Extension version decision and decide whether the existing repository-wide lint failures block the intended next delivery step.

No storage reset, disabling of mobile synchronization or synthetic initial-sync success flag was used to conceal these gaps.
