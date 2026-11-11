# Design

## Context

See [proposal.md](proposal.md) for motivation. Source inspection uses `origin/dev`; the user's current checkout is an older task branch with unrelated work, so implementation must rebase the plan onto a fresh task branch rather than treating the checkout's disabled LCP defaults as the deployed configuration.

### Evidence and its limits

Cloudflare observations below were captured on 2026-11-11, GMT+8, last three days, bots excluded, host `r.slax.com`.

| Cohort / canary | LCP sample count | Good | LCP P75 | TTFB P75 | Render delay P75 |
| --- | ---: | ---: | ---: | ---: | ---: |
| All `/b/` | 725, summed browser groups | 33% | 4,784 ms | 2,999 ms | 1,733 ms |
| Podcast `ea02a6ad-22e9-49ec-bd63-1fb22bf98f75` | 368 | 23% | 5,068 ms | 3,240 ms | 1,905 ms |
| X long-form `a3b123af-27fc-4d12-b329-d8c4fd26b3f6` | 121 | 26% | 6,010 ms | 3,306 ms | 2,520 ms |
| Collection `285f4c1b08ba3f4508d31d1f6b146e37` | 222 | 82% | 1,808 ms | 1,634 ms | 643 ms |

These independently aggregated P75 subparts cannot be added or subtracted to predict a navigation's LCP. Collection and article audiences differ; even within Chrome the observed Good rates differ, approximately 90% for this collection versus 45% for `/b`. This is a useful control, not a randomized comparison.

Confirmed mechanisms:

- Authorized `/b` misses fetch backend metadata, then R2 body, then SSR processors. Cache hits still revalidate full metadata. Anonymous HKG probes obtained actual `x-bcache: hit`; TTFB was about 0.67–0.94 seconds. These probes do not locate the cause of the field 3.2-second tail.
- The podcast's captured compressed response was about 285 KB. Its embedded `script#slax-private-snapshot[type="application/json"]` accounts for 255,918 characters and contains full variants/cues. A local copy with exactly that marker removed changed gzip level-6 size from 288,153 to 130,790 bytes, a 54.6% reduction. No browser LCP improvement has been measured for this projection.
- `strip-html.server.ts` already removes the duplicate article body from the Nuxt payload; `restore-html.client.ts` reconstructs it from visible SSR DOM. The initial article is not inherently waiting for hydration to exist.
- The Mole first image is already eager/high but fails after two proxy wrappers. Direct inner signed URL returns a valid 18 KB PNG with a Reader Referer; forwarding the original article Referer through the outer wrapper returns 403. Image processing then hides the failed image.
- The native podcast audio uses `preload="none"`; the hydrated custom player currently changes this to `metadata`. Its duration is already supplied by `data-duration-ms`.
- Rocket Loader rewrites Nuxt's entry/config scripts. Its effect on these pages has not been measured. The sole Mole video LCP Debug View row is a 7.4-second observation with count 1; it is not the dominant-cause proof for the page.

## Goals / Non-Goals

**Goals:**

- At least 70% of valid field LCP observations are Good (LCP at most 2,500 ms) in each frozen article-family cohort, across overall traffic. Track the reported URLs separately to expose concentration and regressions.
- Make the existing first screen readable promptly while preserving the complete article, headings/anchors, image previews, highlights/comments, original/translated playback, and access decisions.
- Deliver a small first batch with confirmed byte and correctness benefits, then retain timing optimizations only when paired traces demonstrate useful improvement.

**Non-Goals:**

- A site-wide 70% promise, a China-only objective, native app tuning, PDF behavior, new capture providers, or different transcription/model output.
- Body virtualization, moving content behind a click, shortening the article, changing its reading order, or using a placeholder as the largest painted element to improve the score.
- Removing current share revocation checks, serving stale private content, caching personalized HTML as public, new cache infrastructure, or speculative database indexes.
- Expanding the active `public-page-startup` route contract. An anonymous `/b` PowerSync bypass would need sequencing with `optimize-web-lcp` and its open follow-ups; it is not bundled here.

## Decisions

### 1. Establish an outcome contract and a reproducible baseline

Freeze a manifest of public podcast and X long-form `/b` URLs before rollout. Start with the two reported URLs; add representative long/short bodies and text/image/video openings without selecting by their performance. Ordinary tweets, collections, login pages, and PDFs do not count as X long-form articles. Record initial-document versus SPA entry and anonymous versus authenticated entry in lab verification only; the existing Cloudflare LCP report does not expose an authentication dimension or soft-navigation LCP.

The primary acceptance window is seven complete post-convergence days with at least 200 reported LCP counts per family. Both family Good rates must reach 70%; one family's traffic must not hide failure in the other. Report each canary separately; at least 100 reported counts are required before judging its individual 70% target. A sufficiently sampled failing reported canary prevents declaring its family target achieved. Smaller samples remain inconclusive and the observation window extends. Report browser/device/region mix and a matched-mix pre/post comparison alongside the actual post-release rates. A family goal is not a claim that every other URL passes.

An unjudged reported canary also keeps the overall result inconclusive. Compute family rates by summing Good counts and total counts, never averaging URL percentages. The concrete data path is the existing Cloudflare Core Web Vitals report: for each frozen URL, select `Host equals r.slax.com`, `Path equals <pathname>`, `Exclude bots equals Yes` and identical explicit GMT+8 date bounds, then record/export the URL chart's Good / Needs Improvement / Poor counts. The single-path filter avoids the top-15 truncation. Verify every manifest path returns a countable row before freezing it; missing rows remain missing, not assumed zero. These are Cloudflare-reported counts, potentially sampled/estimated, not unique users or a basis for an unqualified statistical-confidence claim.

Classify membership manually from public source/metadata and visible article markup, recording the reason before performance comparisons. Retain a coarse browser grouping fixed at baseline (`Chrome`, `Safari/Mobile Safari`, `Other`) using only browser rows actually exposed by Cloudflare for matched-mix analysis. If available volume cannot support the matching, attribution remains inconclusive. A raw-rate pass caused only by mix change is reported as an observed rate, not a proven optimization success; the matched-mix rate must also reach 70% before claiming this change achieved the target. Region/device slices remain visible with their counts.

Engineering investigation targets are document TTFB P75 at most 1,200 ms and end-to-end LCP P75 at most 2,300 ms on a controlled Chrome profile: 390×844 CSS px, DPR 2, 1.6 Mbps download, 750 Kbps upload, 150 ms configured latency and 4× CPU slowdown. Record the exact Chrome version and measured hardware; repeat the desktop control at 1440×900 CSS px, DPR 1. Safari/iOS is a real-device functional/field control, not falsely labeled as the same CPU emulation. These are initial design budgets with headroom below 2,500 ms, not observed savings or an equation formed by adding marginal percentiles. Run five interleaved pairs for mechanism checks and twenty pairs for a small timing decision. Use the same navigation's LCP subparts when explaining a timing improvement.

Collect a real load trace for each canary at 390 and 1440 CSS px, cold/warm browser and edge cache, plus a mid-range Android/Chrome and Safari/iOS control. Record the actual LCP node and resource, HTML/CSS/JS readiness, long tasks, media transfer, and screenshot filmstrip. Existing beta `Server-Timing` supports backend/R2/article processing; extend narrowly with access, owner/share lookup, trace metadata, fork metadata, collection lookup, and cache validation durations. Production remains free of private diagnostic data; use stage durations only and no token, article text, or raw user identifier logging.

Deployed Worker timer APIs advance at I/O boundaries and cannot reliably attribute CPU-only parsing/SSR work. Use local CPU profiles or existing Workers CPU profiling/observability for that portion, alongside browser traces; a near-zero `performance.now()` span does not prove that work is free. RUM sample counts are not total traffic or a cache-hit-rate estimate.

### 2. Project the browser response without changing stored content

Add `projectWebArticleBody(html: string, apiBaseUrl: string): Promise<string>` under `apps/web/server/utils/` and call it only after `loadContent` has authorized metadata and read the body. Use the existing Worker HTML rewriting mechanism to remove exactly the embedded manifest script. Return the same projection through the same-origin content endpoint so SSR, hydration restoration and client refresh agree. Preserve visible nodes, `data-cues`, media URLs, timing attributes, and every other script/element under the existing sanitization contract.

Keep R2 objects, text exports, snapshot manifests, fork/translation readers, and source hashes unchanged. Web source search currently finds no consumer of this marker; implementation must confirm the full Web call graph and exercise fork/translation/subtitle scenarios before enabling the projection. Avoid stripping all scripts or moving the full body into another client request.

The current `origin/dev` source search finds `/api/content/` callers only in Web page code and Web verification fixtures, not CLI/Extension/Mobile. Recheck those consumers and same-origin Webviews during execution. If a real marker consumer is found, stop the marker-removal milestone and revise the projection contract with that concrete consumer; do not silently remove its input, waive the byte gate, or add a new lazy endpoint.

Execute projection contract tests through the existing Wrangler-bundled Miniflare/workerd mechanism used by `article-loading/browser-harness.mjs`, not a mock HTMLRewriter. Local Miniflare/workerd is the pre-acceptance runtime; remote preview/beta deployment requires separate authorization. If ordinary Node development lacks HTMLRewriter, retain the existing SSR-runner convention of returning the original body consistently for SSR and refresh, explicitly mark that development profile as not exercising the projection, and verify the actual projection in local workerd. No new parser/polyfill compatibility layer is introduced.

For the reported podcast, target at least 40% paired gzip reduction and a final compressed HTML at most 150 KiB when its content is unchanged. Measure actual delivered response compression as well as a same-compressor comparison. This byte gate alone does not satisfy the field goal: the removed script may occur after the first readable content and savings must not be presented as equivalent LCP savings.

### 3. Reuse image proxy URLs and repair existing Web presentation

At API generation, the existing `buildImageProxyUrl` utility must recognize its configured proxy origin/path and verify the existing signed fields before preserving a reusable URL byte-for-byte. New ordinary image sources retain existing signing and upstream access rules. Keep this API signing responsibility in `apps/api/src/utils/imager.ts`; do not put runtime URL parsing/signature implementation into the shared contracts package. Web's different responsibility, selecting an existing inner presentation URL, stays in its own server utility. Do not broaden this to arbitrary third-party proxy services or add a shared framework.

For already saved HTML, the Web projection may replace the observed configured-proxy-inside-configured-proxy source with the complete inner signed URL, preserving its query bytes. Both layers must use the same supported signing mode. Only the known one-extra-wrapper case in `img[src]` is repaired in this batch. Unknown shapes, mode changes, foreign origins, missing signed fields, and unsupported nesting stay on the existing path and are reported rather than guessed. The image endpoint still validates the selected URL's signature and Referer and performs its existing public-target checks. This is a presentation repair, separate from the PR #449 loading-attribute transform, and does not edit stored DOM or selection anchors.

The captured Mole HTML has 11 proxied images whose attributes are only `src`, `alt`, `loading` and `fetchpriority`; no `srcset`, picture source or original-image attribute carries a second identity. Preview reads `currentSrc || src`. Its videos use separate `source[src]` entries and are outside this observed image repair. Order is R2 read → Web projection → existing SSR processors → loading-attribute policy → emitted HTML; client refresh receives the same projection. Existing client image processing does not reconstruct `src` from another attribute. Test those facts against current source before delivery rather than expanding this fix to every media attribute.

Verify original/inner/outer requests in a real browser. The reported first image must render, its natural dimensions must be nonzero, and a reload/refresh must not add another request source or wrapper. Repair can change the LCP candidate and its area; remeasure rather than assuming a fixed LCP improvement.

### 4. Shorten measured metadata work while retaining response freshness

Instrument the synchronous chain before deciding which query dominates. The first bounded API candidate is parallel owner/share reads after the bookmark is known in `resolveBookmarkReadAccess`; decide access only after both results and keep the owner/deleted/moderated/share decision table unchanged. Retain it only when access-level and whole-request timings improve under realistic database latency. Further parallelization of trace/fork/collection work requires the same evidence and must stay after the authorization boundary.

Preserve metadata field values and serialization key order: the HTML revision is based on `JSON.stringify(metadata)`. A reordered object can invalidate all warm entries even if its values are unchanged. Call ordering alone does not establish that every helper performs remote I/O.

A true cache miss performs only the render metadata request. A stale cached revision can trigger validation plus render metadata requests, but carrying metadata across Nitro's render boundary needs extra transport. Reject this candidate in this bounded change rather than adding cross-layer state for that case.

Do not replace full presentation revision validation with a permission-only check: cached title, author privacy, marks visibility, and body identity must remain current. Do not shorten a remote authorization check by merely lengthening TTL or serving it stale. If traces still exceed the TTFB budget, return with the measured blocking stage before introducing a new revision/invalidation architecture.

### 5. Keep media and enhancements off the first readable paint

Retain `preload="none"` when native audio with a supplied positive duration becomes the custom podcast player. If the saved duration is absent or zero, preserve the existing metadata preload so the duration and seek range can initialize. Recheck a restored default start against the actual metadata duration before retaining it. Reuse supplied duration and the existing synchronous seek/play path first: setting `currentTime` before metadata can set the media element's default playback start position, and the existing `userSeeked` guard already prevents resume-position override. Add no new pending-seek state unless a failing real-browser test demonstrates that the existing path is insufficient. Do not defer the first `play()` call to `loadedmetadata`, which can lose Safari/iOS gesture authorization. `seekTo` currently dispatches `PODCAST_EVENTS.seek` synchronously; retain that chain. Guard the existing no-audible-wrong-position behavior in real iOS verification, and reject the no-preload enhancement if correct one-gesture playback/seek cannot be preserved. Seeking, resume position, speed, media session actions, and immediate double-click play/pause remain correct. A failed load uses the existing recoverable player error state.

Trace three additional candidates independently; none ships solely because it sounds beneficial:

| Candidate | Mechanism / implementation surface | Retention test |
| --- | --- | --- |
| Rocket Loader exclusion for Nuxt boot scripts | Compare identical builds with current transformation and a targeted exclusion of the entry/config/color-mode dependency set | Repeated LCP or startup improvement, no theme flash or startup/controls regression; preserve execution order and verify emitted HTML |
| Defer expensive nonessential article processing | Time processors and mark drawing in `useArticleSelection` / `DOMPipeline`; schedule only work proven to block the first paint or a long interaction | Same visible SSR body and selection anchors; immediate reading/links and normal annotation readiness; no new interaction long task |
| Stable podcast player upgrade / offscreen rendering | Measure layout at native-to-custom replacement and layout/paint below the viewport | No added layout shift; sticky playback, find-in-page, deep anchors, selection/highlights and accessibility remain correct at 390/768/1440 px |

Do not apply `content-visibility` to the entire article or virtualize it in this change. If offscreen rendering merits a separate section-level experiment, use existing semantic section boundaries and retain complete DOM; reject it on search, anchor or mark-geometry failure.

## Risks / Trade-offs

- [Removing a browser manifest breaks a hidden consumer] → Prove the Web call graph and media/fork behavior first; preserve canonical stored snapshots and playback attributes.
- [Restored images become larger LCP candidates] → Restore correctness, preserve deterministic priority, and report the new element and actual timing.
- [Faster cached delivery leaks revoked or changed presentation] → Keep fresh metadata validation and run revocation/privacy/moderation checks on warm hits before release.
- [A delayed audio load loses an early seek] → Hold the requested time until metadata permits applying it; verify play/seek before metadata and reload-resume scenarios.
- [A broad runtime change trades LCP for broken controls or INP] → Pair each change against baseline and reject repeatable control regressions greater than both 100 ms and 5%, new interaction long tasks, or functional failures.
- [A 70% aggregate hides a poor audience] → Report both families, the two canaries, and browser/device/region slices with counts; do not average page percentages or drop slow cohorts after observing them.

## Migration Plan

1. Review this proposal and its constraints. Prepare `perf/optimize-public-article-lcp` from current `origin/dev`; reconcile open changes without duplicating their capability deltas.
2. Capture baseline and land the confirmed projection/proxy fixes with independent commits and focused running-environment evidence. No stored-body migration is needed.
3. Retain the current cache key and 600-second TTL. Wait for old-format responses to expire before measuring convergence; keep old hashed assets available through overlap.
4. Measure and retain the API/media/client candidates one mechanism at a time. Ask about versions of indirectly affected shipped applications before committing/pushing/handoff when required by repository policy. Complete human hands-on acceptance before the task PR opens.
   Confirmed correctness/byte fixes may be released as an intermediate build with explicit remaining target work. If controlled end-to-end LCP remains above the 2,300 ms budget, do not start the final target-verification window or claim that release is expected to reach 70%; return with the measured binding stage. The 1,200 ms TTFB target is diagnostic: a candidate meeting end-to-end LCP despite a different phase allocation can proceed, with that allocation documented.
5. After human-controlled promotion/deployment of a target candidate, verify build and cache convergence, then start the seven-day outcome window. Record results in `validation.md`; fewer than the required reported counts, an unjudged canary, an unmatchable traffic mix or mixed builds do not establish success.
6. Roll back an offending mechanism by reverting its isolated commit/configuration and deploying. Keep the existing 600-second cache TTL and revision checks; wait at least 600 seconds for old-format responses to expire after deployment or rollback, then verify response and asset convergence. Do not rewrite canonical snapshots during rollout or rollback.

## Planning Review

On 2026-11-11, two independent read-only Claude Code agents were invoked with requested model `claude-opus-5-5` for server and client analysis, followed by a fresh builder check of the proposal/design/specs/plan. Codex verified recommendations against current source and the captured response before adopting them.

- Incorporated: independent owner/share reads, stable metadata revision serialization, exact proxy/mode handling, response-only manifest projection, Worker CPU measurement limitations and synchronous iOS gesture-authorized media intent.
- Builder-check questions resolved in the artifacts: an unjudged canary blocks success; exact per-path Cloudflare counting and manual family classification; raw versus matched-mix outcome rules; consumer-discovery hold point; observed image attributes and transform order; the shared two-argument projection signature, real workerd tests and explicit Node-dev limitation; and intermediate release versus final target-candidate gates.
- Excluded from this bounded proposal: speculative pre-authorization R2 reads, a permission-only revision endpoint, new telemetry destination/dependency, extra cache infrastructure, a stored-body backfill, and another active public-startup capability delta. None has demonstrated benefit needed to justify its scope here.
- Quantile caveat: TTFB P75 above 2,500 ms constrains at least the upper quartile; it does not mathematically prove that a 70% Good rate is impossible. Likewise, RUM sample counts do not establish field cache-hit rate. No savings or target attainment is inferred from those shortcuts.
- Documentation-only planning verification is exempt from running-app evidence. Implementation, human hands-on acceptance, deployment, CPU traces and field target verification remain pending in `tasks.md`.

## References

- [Cloudflare report](https://dash.cloudflare.com/f74694cd77e247e071af286f40d20116/web-analytics/overview?siteTag~in=2dc72e6d3741449093f7df924207957c&excludeBots=Yes&host=r.slax.com&time-window=4320)
- [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [Rocket Loader script exclusions](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/)
- [Content visibility and offscreen rendering](https://web.dev/articles/content-visibility)
- [Worker timer limitations and CPU attribution](https://developers.cloudflare.com/workers/runtime-apis/performance/)
- [WebKit user-gesture playback requirements](https://webkit.org/blog/6784/new-video-policies-for-ios/)
- [Implementation plan](../../../docs/superpowers/plans/2026-11-11-optimize-public-article-lcp.md)

## Implementation review corrections

The 2026-11-11 independent review identified the stale-hit/miss distinction, unnecessary cache namespace changes, HTML attribute entity handling, and pre-metadata resume/skip behavior. This change retains the existing cache key and TTL, rejects the cross-render metadata handoff, verifies HTMLRewriter behavior with serialized attribute fixtures, and tests saved-position/explicit-seek precedence before changing preload. Same-mode image reuse verifies the original digest; mismatched modes keep the existing signer path. No remote deployment or Rocket Loader zone mutation is authorized by implementation approval.
