# Public Article LCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach at least 70% field LCP Good separately for public podcast and X long-form article cohorts, with the reported podcast and Mole URLs kept as canaries.

**Architecture:** Project the authorized Web article response without mutating canonical snapshots, reuse signed image proxy URLs, shorten measured metadata dependencies, and keep podcast enhancement off the readable first paint. Preserve synchronous access/presentation validation and the existing SSR-body restoration contract. Retain optional client changes only after paired traces prove benefit.

**Tech Stack:** Nuxt 4 / Vue 3, TypeScript, Cloudflare Workers HTMLRewriter and Cache API, R2, existing API repositories, Vitest, real Chromium and Safari/iOS verification.

**Spec:** [OpenSpec design](../../../openspec/changes/optimize-public-article-lcp/design.md), [public article delivery](../../../openspec/changes/optimize-public-article-lcp/specs/public-article-delivery/spec.md), [image proxy reuse](../../../openspec/changes/optimize-public-article-lcp/specs/image-proxy-reuse/spec.md).

## Global Constraints

- Implementation authorized after regression review on 2026-11-11; follow existing naming/layer responsibilities and make minimal changes without incidental refactoring; implementation branch `perf/optimize-public-article-lcp` starts from current `origin/dev` and targets `dev`.
- Field goal: each family Good at least 70%, seven complete post-convergence days, at least 200 reported LCP counts per family; reported canaries require at least 100 counts before judging their individual 70% target. A missing/unjudged canary keeps the overall result inconclusive; matched-mix rates must also reach 70%.
- No canonical snapshot mutation, database migration, new runtime dependency, broad cache infrastructure, body virtualization, or overlapping delta for `article-image-loading` / `public-page-startup`.
- Keep complete visible content, anchors, playback/translation/subtitles, image previews, highlights/comments and fresh sharing/privacy/moderation decisions.
- Initial controlled-profile budgets: TTFB P75 at most 1,200 ms; end-to-end LCP P75 at most 2,300 ms. These are design targets, not measured savings; marginal percentiles are not additive.
- For unchanged reported podcast content: paired gzip reduction at least 40% and delivered compressed HTML at most 150 KiB. A byte result is not an LCP result.
- Human hands-on acceptance precedes the task PR; affected application version decisions precede implementation commits/push/handoff as required. Only the documentation-only planning portion is exempt; implementation evidence belongs in validation.md.

## Review Focus

- A warmed page whose sharing or author privacy changed must not expose its earlier body/presentation — Task 3 tests revocation, deletion, moderation, hidden marks/profile and credential isolation.
- Reprocessing an RSS-mode or already signed image must not add a wrapper, change its effective mode, or normalize away signed query bytes — Task 2 pins those cases.
- The Web response may lose the embedded manifest, but forks/translations/subtitles must still read their full canonical data — Task 3 exercises all three consumers and hydration/refresh identity.
- A paragraph seek arriving before audio metadata must beat a saved resume position and play exactly once — Task 5 tests early seek and rapid play/pause.
- A performance change must not obtain a better LCP by removing content, delaying it until interaction, or breaking later navigation/annotations — Tasks 1 and 6 check filmstrip/content identity and live controls.

---

## File and interface map

| Surface | Responsibility |
| --- | --- |
| `apps/api/src/utils/imager.ts` | Existing API image signing and reusable-URL verification; no new shared package or cross-app import |
| `apps/api/src/utils/imager.ts` | Validate/reuse an existing signed URL or sign an ordinary source under the requested mode |
| `apps/web/server/utils/webArticleBody.ts` (new), `loadContent.ts` | Authorized browser-only projection, including marker removal and the observed nested source repair |
| Existing share-cache middleware/plugin | Preserve current authorization/revision checks and 600-second format convergence |
| `apps/api/src/utils/bookmarkAccess.ts`, `domain/orchestrator/content.ts`, `handler/http/contentHandler.ts` | Measured access/metadata timings and independent reads with stable output/revision |
| `apps/web/app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue` | Intent-driven audio loading and pre-metadata seek correctness |
| `apps/web/app/composables/bookmark/useArticleSelection.ts`, `components/Article/processors/*` | Only client work proven to block first paint or interactions |
| This change's `validation.md` (new during execution) | Build/trace/field evidence and decisions on every conditional candidate |

### Task 1: Establish comparable traces and a field denominator

**Files:** Create `openspec/changes/optimize-public-article-lcp/validation.md`; add synthetic fixtures under `apps/web/tests/fixtures/article-loading/`; modify existing timing callbacks in `apps/api/src/handler/http/contentHandler.ts`, `apps/api/src/domain/orchestrator/content.ts`, `apps/web/server/utils/loadContent.ts` and `apps/web/server/middleware/share-cache.ts` only as needed for stage attribution.

**Interfaces:** Consume existing `recordTiming(step: string, durationMs: number)` and beta `Server-Timing`; produce a dated evidence table and frozen family URL manifest for every later task.

- [ ] Capture five interleaved unchanged-build loads per canary at 390/1440 px, cold/warm browser and edge cache, plus the existing collection control. Record actual LCP nodes, screenshots/filmstrip, document redirect/TTFB/download, render-blocking CSS/fonts, boot readiness, long tasks and a clean closed-panel DOM count.
- [ ] Add timing tests asserting named stage durations are nonnegative and diagnostics contain no credential or article fields; run the focused API/Web suites and confirm failure before instrumentation when a new duration is asserted.
- [ ] Emit only the missing stage timings through the existing beta diagnostic path. Record access, owner/share, trace/fork/collection metadata, R2, Web projection and cache-validation timing; preserve response/access behavior.
- [ ] Run focused tests and local workerd requests; verify the fields and cache outcome are visible and public production responses still follow their current diagnostic contract. If production attribution is necessary, use bounded scalar internal logs through the existing logging mechanism, with no new telemetry service.
- [ ] Freeze cohort membership by manually recorded source/markup classification and verify every URL can be retrieved through the design's exact Cloudflare host/path/date/bot filters. Sum Good and total counts; retain missing rows and sampling/estimation limits explicitly. Use the design's 390×844 / DPR 2 / 1.6 Mbps down / 750 Kbps up / 150 ms / 4× CPU Chrome profile and twenty interleaved pairs for a small timing decision. Record this measurement commit only after applicable version decisions.

### Task 2: Make image proxy generation reusable

**Files:** Modify `apps/api/src/utils/imager.ts`; create `apps/api/test/utils/imageProxyReuse.test.ts`; retain existing endpoint authorization tests in `apps/api/test/handler/http/imageProxy.test.ts`.

**Interfaces:** Preserve `buildImageProxyUrl(env, url, referer, mode?)`. Reuse its existing digest primitives in that utility; no new contracts subpath or app-to-app import. Match the exact configured proxy origin/path and verify the signed source before reuse. Web presentation repair is a separate server responsibility, not an import of API implementation.

- [ ] Write failing assertions for ordinary URL behavior, byte-identical reusable signed input, repeated processing, exact origin/path recognition, invalid signatures and RSS mode mismatch. Preserve RSS signing/public-target semantics; mode mismatch continues through the existing signer and is never reused as another mode.
- [ ] Run `pnpm api -- test test/utils/imageProxyReuse.test.ts test/handler/http/imageProxy.test.ts`; verify the new assertions fail for current wrapping behavior.
- [ ] Add only the verified reuse/mode behavior in the existing utility. Keep ordinary signing and endpoint signature/Referer/public-target checks unchanged.
- [ ] Run focused API tests and an actual two-pass synthetic capture, verifying one stable source URL. Commit the isolated change only after required impact/version decisions.

### Task 3: Deliver a lean and consistent Web body

**Files:** Create `apps/web/server/utils/webArticleBody.ts` and `apps/web/tests/fixtures/article-loading/web-body-projection.mjs`; modify `apps/web/server/utils/loadContent.ts`; extend `apps/web/tests/unit/server/shareCacheIsolation.spec.ts` and the existing article-loading browser harness.

**Interfaces:** Export `projectWebArticleBody(html: string, apiBaseUrl: string): Promise<string>`. It removes exactly the server manifest script and repairs only one known extra configured-proxy wrapper in `img[src]`, selecting the complete inner signed raw URL only when the modes agree. Keep its source-selection logic local to this Web boundary and derive the known `/static/image` endpoint inside the utility, after the Worker-runtime check, from the existing public API base; no signing salt, new configuration system or shared-package export. Do not infer trust from an arbitrary hostname substring. Run projection output assertions through the existing Wrangler-bundled Miniflare/workerd pattern; do not mock HTMLRewriter. Node-only dev retains the original-body fallback consistently and is not the projection acceptance runtime.

- [ ] Recheck all marker and `/api/content/` consumers, including Webviews, before removal; a discovered manifest consumer holds this milestone for a concrete contract revision rather than a new lazy endpoint. Write failing workerd tests for exact marker removal, visible text/order/anchors/`data-cues`, signed source bytes, untouched unsupported/foreign/deeper/mode-mismatched nesting and idempotence. Assert storage and SSR/refresh identity, and verify the observed Mole image/preview use only the repaired `src` identity.
- [ ] Run `node apps/web/tests/fixtures/article-loading/web-body-projection.mjs` and `pnpm web -- test tests/unit/server/shareCacheIsolation.spec.ts`; verify the new projection assertions fail before implementing it.
- [ ] Implement with the existing Worker HTMLRewriter after authorization and R2 read, before article SSR processing and the loading-attribute transform. Return the same projection through `/api/content/[uuid]` and initial SSR. Preserve the existing stripped-Nuxt-body/restored-DOM contract and verify client processors do not reconstruct the removed outer source.
- [ ] Retain the existing cache key and TTL. Document the 600-second format convergence and test sharing revocation, owner deletion, moderation, hidden author/marks and credentials against warm hits. Keep metadata revision checks intact.
- [ ] Run real Chromium + Worker hydration/refresh checks: first Mole image renders with nonzero natural size; full article/anchors remain; subtitle opening, translation and fork still work from canonical data. Run paired compression checks against unchanged podcast content; verify at least 40% lower gzip and at most 150 KiB delivered compressed HTML. Record byte results separately from trace LCP, then commit.

### Task 4: Reduce measured metadata dependencies

**Files:** Modify `apps/api/src/utils/bookmarkAccess.ts`, optionally `apps/api/src/domain/orchestrator/content.ts`; extend `apps/api/test/flow/content/contentDetail.test.ts`.

**Interfaces:** Preserve the current access result, complete `getContentMeta` JSON values and serialization key order.

- [ ] Write failing concurrency assertions that owner/share reads begin after the known bookmark and before either settles, while denied/deleted/moderated/hidden-profile cases return the existing result. Snapshot complete metadata JSON and its revision to prevent an accidental cache format churn.
- [ ] Run focused content-flow tests and confirm the new concurrency assertion fails; implement owner/share parallel reads with the same final decision table. Parallelize trace/fork/collection work only where Task 1 timings show material independent waits after access is known.
- [ ] Run focused tests and paired real requests. Keep the change only with stable metadata/revision output and meaningful whole-request improvement. Call ordering is not proof that each helper performed a remote query; use measured spans.
- [ ] Record rejection of stale-hit metadata reuse: true misses already fetch once and a cross-render handoff would expand layer responsibilities.
- [ ] Record each retained/rejected mechanism with cold/hit/stale timings, then commit retained changes independently. If network/connection time dominates and the TTFB budget remains unmet, bring back that measured constraint rather than adding a new cache/invalidation framework.

### Task 5: Preserve no-preload audio and early playback intent

**Files:** Modify `apps/web/app/components/Article/CEComponents/podcast/PodcastPlayer.ce.vue`; create `apps/web/tests/unit/components/Article/PodcastPlayer.spec.ts`; extend `apps/web/tests/unit/components/Article/processors/podcast.processor.spec.ts` and the media browser fixture.

**Interfaces:** Existing player props and `PODCAST_EVENTS.seek` remain unchanged. Keep the synchronous gesture → `seekTo` → event listener chain. Invoke the first play-intending `play()` synchronously inside that gesture, without waiting for metadata; retain the existing `currentTime` and `userSeeked` behavior unless a failing browser check requires a small correction. Explicit intent beats persisted resume position. Reuse the existing duration prop and player error UI; do not introduce an asynchronous first `play()` from `loadedmetadata`.

- [ ] Write failing tests requiring custom audio `preload="none"` for supplied positive duration (metadata preload for unknown duration), supplied duration before metadata, synchronous play in the gesture before metadata, pending paragraph/progress seek, no resume override, one play attempt per intent and correct rapid play/pause/rate/media-session behavior.
- [ ] Run `pnpm web -- test tests/unit/components/Article/PodcastPlayer.spec.ts tests/unit/components/Article/processors/podcast.processor.spec.ts`; confirm the preload/early-seek assertions fail before the fix.
- [ ] Change preload behavior and retain existing seek/play lifecycle; add only corrections justified by a failing check; keep the native fallback, sticky placement and controls.
- [ ] Verify in Chromium and real Safari/iOS that upgrade starts no audio transfer before intent, early chapter seeking plays from the requested position with one gesture, no wrong-position audio is audible, resume works and media failures remain recoverable. Reject the enhancement if these controls fail; record network/interaction evidence and commit retained behavior.

### Task 6: Retain only demonstrated client critical-path changes

**Files:** Task 1's evidence record; if selected, `apps/web/nuxt.config.ts` / emitted-head integration for script exclusions, `apps/web/app/composables/bookmark/useArticleSelection.ts`, and the measured processor/player files. Tests belong beside the selected surface; do not create generic scheduling infrastructure.

**Interfaces:** Consume Task 1 paired-trace protocol and preserve the spec's complete readable SSR content and control contracts. This task produces a retain/reject decision for each candidate; a rejected experiment is a completed investigation, not an undisclosed implementation gap.

- [ ] Compare identical builds with current Rocket Loader and targeted boot-script exclusion. Verify transformed HTML and script ordering, theme initialization, hydration and controls. Only retain repeatable LCP/startup improvement; document the exclusion scope and rollback if retained.
- [ ] Attribute long tasks/layout around actual LCP and the Mole slow paragraph interaction. Select the single highest measured blocker among processors, mark drawing and player replacement, then write a failing behavioral/performance fixture for that mechanism before changing it.
- [ ] Implement that bounded change and rerun paired traces plus deep anchors, find-in-page, image previews, highlights/comments, translation/subtitles, keyboard controls and 390/768/1440px theme checks. Reject changes that hide content, add interaction long tasks or regress controls by both more than 100 ms and 5%.
- [ ] Evaluate section-level offscreen rendering only if layout/paint dominates; retain complete semantic DOM and reject it on search, anchor or selection geometry failure. Broader startup-route changes or virtualization return to proposal review rather than being added here.
- [ ] Commit retained mechanisms separately and record every rejected candidate and actual timing; do not convert an empty experiment into a promised millisecond saving.

### Task 7: Review, release and verify the 70% outcome

**Files:** This change's `validation.md` / `tasks.md`, affected application version files only after the required human decision, and the eventual task PR body.

**Interfaces:** Consume all retained mechanism results and the frozen cohort manifest. Produce task-PR evidence first, then a post-release field outcome after human-controlled promotion/deployment.

- [ ] Run affected Web/API focused and full tests, typechecks/builds, changed-file lint, actual Worker/browser smoke and `pnpm exec openspec validate --all --strict`. Record exact commands, results and agent-executable gaps without counting a synthetic fixture as production evidence.
- [ ] Complete human hands-on acceptance for restored images/player/reading behavior before opening the task PR. Ask required version questions based on actual shared-package/build effects. Perform Bugs/Security/Compliance review, fix Important findings and use `OpenSpec: optimize-public-article-lcp` in the PR evidence.
- [ ] If controlled end-to-end LCP still exceeds 2,300 ms, hold the final target window and return with the binding stage; confirmed correctness/byte fixes can be a separately identified intermediate release with remaining target work. After authorized target-candidate deployment, verify new build, projection format, old assets and rollback convergence before the final field window.
- [ ] Observe seven complete days with at least 200 reported LCP counts per family and 100 per canary; report summed-count raw rates, matched browser-mix rates and sampling/estimation limits. Claim optimization success only when both families and both judged canaries meet 70%, matched-mix rates also pass and no material functional/INP/CLS regression exists. Any unjudged canary, missing denominator or unmatchable mix keeps the overall outcome inconclusive; extend observation and keep failures open.

## Rough execution estimate

Planning estimate: baseline and attribution 0.5–1 engineer-day; confirmed proxy/projection/audio work 1–2 days; measured TTFB/client candidates and integration 1–2 days. This is approximately 3–5 engineer-days after review, plus deployment/acceptance time and at least seven complete post-convergence observation days. Re-estimate if traces show the remaining gap is infrastructure/network dominated. No date or field gain is guaranteed by this estimate.
