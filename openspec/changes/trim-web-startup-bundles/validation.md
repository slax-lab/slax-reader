# Validation: official framework loading

## Current revision

On 2026-11-11 the user explicitly requested removing the custom loading machinery from draft PR #560 and using official mechanisms. This record supersedes the older index/preflight and same-document retry results. Branch: `feat/lazy-load-bundle`; integrated base: `6016ee48`. Extension source/version remains unchanged at 1.16.3. No merge, deployment or archive is authorized.

## Removed and retained

Deleted ten bespoke implementation/test files: DeferredSnapshotPanel.vue, deferredUi.ts, deferredModal.ts, deferred-resource-hints.ts, resource-hints.ts, and their five corresponding test files. There is no generated resource index, compile-time index define, fetch-before-import routine, custom promise cache, dependency classifier or graph-traversal plugin.

- Panels use Vue defineAsyncComponent with the existing loading component, 15-second timeout and suspensible:false. Existing selection/authorization controls v-if.
- Vue KeepAlive preserves inactive instances; account-generation keys isolate cached state.
- NuxtErrorBoundary contains optional-panel failures. Its error slot warns about unsaved drafts and offers explicit reloadNuxtApp; there is no automatic reload or database reset.
- Programmatic modals use direct import() and the original modalBootloader, with existing toast feedback on failure.
- One statement in the existing build:manifest hook sets all resource prefetch flags false. This is an explicit **global speculative HTML resource-prefetch opt-out**, not a route-specific classifier. Required preload/imports and NuxtLink route-prefetch behavior are unchanged. Upstream login preload collection remains in the hook.
- The existing bookmark composable holds only quote intent until the real chat ref exposes addQuoteData, clears it on account/scope changes and consumes it once. This business readiness handling is not a module loader.
- The chat's existing immediate watcher called addLog before its const initialization when first mounted visible. Moving that unchanged function above the watcher resolves the observed ReferenceError; an initially-visible regression case was added.

## Framework references

Read official documentation and checked the installed Nuxt 4.5.2, Vue 3.5.42 and Vite 8.2.2 implementations:

- https://vuejs.org/guide/components/async.html
- https://vuejs.org/guide/built-ins/keep-alive.html
- https://nuxt.com/docs/4.x/api/components/nuxt-error-boundary
- https://nuxt.com/docs/4.x/api/advanced/hooks
- https://nuxt.com/docs/4.x/api/utils/reload-nuxt-app

Framework support does not imply that a repeated import clears the browser module-error cache. This revision intentionally does not promise same-document recovery after such a failure; recovery is the user's explicit page reload, with a draft-loss warning.

## Automated verification

Same locked production configuration as the retained builds: SLAX_ENV=production; PUBLIC_BASE_URL, AUTH_BASE_URL and SHARE_BASE_URL=http://127.0.0.1:4173; DWEB_API_BASE_URL=http://127.0.0.1:4174; COOKIE_DOMAIN=127.0.0.1; COOKIE_TOKEN_NAME=slax_token; GOOGLE_OAUTH_CLIENT_ID=example-client; NUXT_TELEMETRY_DISABLED=1. No secret configuration was read or copied.

| Check | Result |
| --- | --- |
| `pnpm --filter @apps/slax-reader-dweb test` | 233 files passed / 1 skipped; **2,745 tests passed / 3 skipped** |
| `pnpm --filter @apps/slax-reader-dweb typecheck` | Passed |
| `pnpm --filter @apps/slax-reader-dweb build` | Passed |
| `pnpm --filter @apps/slax-reader-dweb lint` | Existing **89 errors / 437 warnings** remain; not represented as passed |
| `pnpm exec openspec validate --all --strict` | **124 passed / 0 failed** |
| `git diff --check` | Passed |
| Worker asset validation/index comparison | Passed; unchanged relative to saved integrated build |
| Generated custom index scan | No deferred-ui index files |

The lower test count is due to deleting tests for the removed infrastructure, not silently skipping tests. Regression coverage now lives in the existing chat and bookmark suites, including initially-visible chat, loading-placeholder refs, first quote delivery, exactly-once handling and account changes. Existing modal input/callback tests still pass. The earlier Extension checks (108 tests, typecheck, production build) remain applicable: this revision does not alter Extension or the shared text implementation.

## Matched bundle comparison

Both stages use the same integrated base, lockfile and production settings. `integrated` is the previous custom implementation and `official-verified` is this revision. Deduplicate manifest entry roots, the appropriate layout, route JS/CSS and the library's immediately needed BookmarksPage implementation. Gzip uses per-file level-9 recompression; it is not measured CDN transfer or a latency prediction.

| Route | Previous raw bytes | Official raw bytes | Previous gzip bytes | Official gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| `/login` | 678,559 | 677,139 | 245,248 | 241,965 |
| `/b/:id` | 1,424,501 | 1,423,562 | 452,358 | 447,908 |
| `/c/:id` | 823,628 | 821,407 | 291,165 | 287,096 |
| `/` / `/bookmarks` | 1,091,857 | 1,089,116 | 375,392 | 370,627 |

These numbers compare against the preceding custom implementation, not the older original-base table. The 3–5 KiB gzip difference is not a claimed proportional speedup. The key result is that optional code remains out of initial requests without the custom index/downloader.

## Real browser exercise

Used Kimi Code Desktop's built-in browser. The retained Pages production Worker runs through the installed Miniflare adapter with synthetic BACKEND/R2 content and a local fixture account. Production JS/CSS are unmodified; only a read-only HTML probe reports resource timings, errors and Vue-boundary state. No real OAuth, chat submission, production account or remote mutation was used.

- Anonymous article: readable title/body; no page errors; zero startup requests for AI panel, chat panel, Markdown parser or LoginModal. No custom resource-index request or file exists.
- Save for later: direct dynamic import displays the real login modal, with original redirect and dismissal UI.
- Owner chat: the official async component mounts correctly after the synthetic profile flow. Entering `Official KeepAlive retains this draft`, switching to Analysis and returning to Chat preserves the exact textbox value.
- First quote: select actual article text before chat has been activated and invoke Chat from the selection menu. The selected quote appears in the newly loaded chat. No chat message is sent automatically.
- Error containment: on a fresh origin (4185), the AI chunk is deliberately failed twice. The article remains readable; NuxtErrorBoundary displays `Unable to load this interface. Reload to try again; unsaved drafts will be lost.` and a `Reload page` button. No automatic document reload occurs.
- Explicit recovery: clicking the official reloadNuxtApp action issues the second document request; the resource is then available and the real `Fixture outline` renders. Post-reload probe has no page or boundary errors. No storage reset code was added.

The first prototype exposed the pre-existing chat declaration-order bug; only the corrected final artifact is accepted. The synthetic fresh-account flow can initially trigger the existing login guard before profile persistence; it was retested after normal profile completion, without weakening authorization. Synthetic overview generation is not a real backend and is not claimed to pass.

Ignored local evidence: `.local/bundle-validation/official-verified/comparison.json`, `error-recovery.json`, test/build task logs, `official-final-browser-reports.json`, and `official-failure-browser-reports.json`. Production builds and fixtures remain untracked.

## Review and remaining limits

Bugs/Security/Compliance review: the custom loader is removed rather than renamed, no new dependency or data-reset path is introduced, required preload and upstream login optimizations remain, and the failure wording accurately describes a user-initiated reload. No new Important code finding remains in the exercised scope.

The previous same-page retry promise, generated-index tests and pending-loader duplicate coalescing are intentionally removed under the user's simplification request. The global speculative-prefetch opt-out may trade future navigation warmth for fewer unsolicited requests; required resources still load on demand.

Human hands-on acceptance remains pending. PR #560 is currently marked ready for review by its owner; that status change is not recorded as hands-on acceptance and does not satisfy the acceptance gate. Physical iOS Safari, production HTTP 499, real OAuth, remote initial-library synchronization/upload and paired extension bridge are not verified by these fixtures. Do not claim this revision fixes those scenarios or restores all unsaved component state on reload.


## Review follow-up for aa1aee95

The failing GitHub check was `PR review gate` / `review_verdict`, not Web or Extension build/test CI. Review 5853892287 identified three Important findings.

- KeepAlive re-entry: use the official onActivated/onDeactivated lifecycle in addition to the existing isAppeared watcher. One appearance guard prevents duplicate initial open/activation effects. A real KeepAlive regression test deactivates/reactivates twice and asserts the same textarea/draft, focus, bottom-follow scroll and exactly `open, expand, expand`; the non-cached false-to-true path is also covered.
- Scope: the original user-selected optimization routes were `/b`, `/c`, `/login`, and `/`. Proposal, design and delta spec now explicitly scope panel deferral to `/b/:id`. `/s/:id` retains its eager panels; its only page-local edit is the pure-text import, and no share-reader byte reduction or full browser acceptance is claimed. Shared composable behavior is retained and tested.
- Human acceptance: still required and not fabricated. Agent browser evidence is not a substitute. This remains a real review gate item until the human supplies the required acceptance.

Nits addressed: use a literal newline in the pure helper; import raw text source through Vite instead of assuming process.cwd(); use the rejection callback of import().then() so setup/mount errors are not mislabeled as download failures. Six modal tests cover the latter. A custom loadModal helper was deliberately not reintroduced because the user explicitly required its removal.

The prior body incorrectly called the PR a draft after its owner changed that status. The next body update reports the actual state and the outstanding acceptance rather than treating ready status as approval.


### Review-fix verification

- Focused chat suite: 50 tests passed, including true KeepAlive reactivation twice and the legacy visibility-watcher path. Modal and text suites: 39 tests passed.
- Two default-concurrency full-suite attempts hit the unchanged useSlaxRoutes #imports test's 10-second timeout; that file passes independently. Without changing assertions, repository config or timeouts, `vitest run --maxWorkers=2` passed all **2,753 tests**, with 3 skipped (233 files passed / 1 skipped). Typecheck and production build then passed. The default-concurrency failures are not represented as a green standard run.
- Real production browser: enter a draft, click Analysis, then return to Chat. The read-only probe observed focus move from TEXTAREA to BUTTON and back to TEXTAREA, with `KeepAlive review fix preserves draft and focus` retained, no page/boundary errors and zero chat POSTs. Bottom-follow and exactly-once open/expand analytics are asserted in the real KeepAlive unit harness. Evidence: `.local/bundle-validation/review-fixed/reentry.json`.
- Changed-file ESLint diagnostics match the reviewed head: component and modal implementation files are clean; existing test-file warnings were not broadened or fixed. Shared text output is unchanged; only newline spelling changed.
- Local Bugs/Security/Compliance follow-up: code regression and scope wording are addressed. The repeated modal helper suggestion is declined to respect the explicit no-custom-loader request; import-only error handling is fixed independently. Human hands-on acceptance remains an unresolved Compliance finding, not a technical failure that an agent can mark passed.


## Hands-on feedback: recovery controls

The user reported that the reload controls looked unstyled and did not respect the existing Web design. This is corrective feedback, not approval. Both `/b/:id` error slots now use the existing 24px reading-panel inset, auxiliary sans-serif type scale, muted explanatory text, and a restrained bordered secondary button. The action retains the same explicit reload behavior and unsaved-draft warning. No icon, animation, shadow, framework, token or data-policy change was added.

Reuse anchors: `SnapshotAIPanel.vue` sidebar text/retry styling, the existing `.pdf-ai-unavailable` inset, and `AddUrlTopModal.vue` bordered secondary-button pattern. All colors, typography and radius come from current `--slax-*` tokens. The button has hover/pressed states and a visible 2px keyboard focus ring.

Verification on the rebuilt production artifact:
- Targeted page ESLint, 2,753 Web tests (3 skipped), typecheck and production build passed.
- Visually checked light, dark and e-ink at desktop 1280px and narrow mobile 375px using the product theme switcher. The warning wraps on mobile, the existing sheet remains intact, and the button stays 112 x 44 CSS pixels.
- Computed styles confirm existing light/dark colors, 10px theme radius, e-ink black/white colors with 2px radius, no transition/animation added, and no horizontal overflow. Keyboard navigation shows a solid 2px e-ink focus outline.
- At the 768px breakpoint the read-only DOM probe confirms the same 44px target and no horizontal overflow. The browser preview produced a tiled capture artifact during resizing, so that image is not counted as visual acceptance; desktop/mobile screenshots and DOM measurements are recorded separately.
- After local resource faults were lifted, clicking the styled button reloaded the document and returned the normal article with no captured page errors.

Ignored evidence: `.local/bundle-validation/recovery-styled/styles.json`, `styled-acceptance-session.json` and the persisted local acceptance fixture. The portal at 4188 serves the corrected build and stays running without a timeout. The user must review the corrected appearance before acceptance is marked complete.
