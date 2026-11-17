# Baseline and implementation evidence

## Status

Update, November 16, 2026: the requester subsequently reported #605 production deployment. Verification resumed; see the section "PR #605 production verification resumed" for fresh deployment, resource, interaction and early field evidence. Earlier deferral statements below describe the planning/delivery state at that time. PR #624 remains an unmerged draft; its runtime effect is not part of this production result.

Later update: the "Successful test-article first-byte attribution" section records newly discovered public test articles, successful stage measurements and temporary worker-tail observations. It supersedes the earlier missing-normal-sample attribution gap, while retaining the original same-content, controlled-profile and field gaps. No additional runtime optimization is claimed. A subsequent November 17 section adds Ray-ID-matched native traces, corrects the timer interpretation and records the next-morning production RUM window.

Based on `origin/dev` merge `2203281e2a9f3606d0a686e2b8be34ae84fb1f99`, fetched November 16, 2026. The initial planning phase changed documentation only. The change requester subsequently approved only initial player-layout stabilization. The implementation below changes the existing Web article stylesheet and browser fixtures; it changes no API, media lifecycle, stored content, configuration, dependency or generated output. The change requester has now requested task completion and a draft pull request; production deployment remains outside this task. Delivery status is recorded below. The change requester has now reported hands-on acceptance of the local initial-player change; production LCP Good improvement is not claimed.

## PR #605 deployment check

- GitHub reports #605 merged into `dev` at `2026-11-16T03:21:40Z` (11:21 GMT+8), merge `2203281e`.
- [Web deploy run](https://github.com/slax-lab/slax-reader/actions/runs/43797724619) completed successfully.
- [API deploy run](https://github.com/slax-lab/slax-reader/actions/runs/43797724633) completed successfully.
- `origin/main` remained at `7a687950` when checked. These checks do not claim production deployment or a production Good-rate improvement.

Anonymous GETs to the documented test hostname `https://r.slax.dev` returned the following. No credentials were supplied. Time to headers includes connection setup; these are missing-article responses, not successful article performance samples.

| Production canary UUID | Test status | Article body | Diagnostic response |
| --- | --- | --- | --- |
| `ea02a6ad-22e9-49ec-bd63-1fb22bf98f75` | 404 | Absent | Fixed frontend cache/backend and edge/core timing stages present |
| `a3b123af-27fc-4d12-b329-d8c4fd26b3f6` | 404 | Absent | Same diagnostic boundary present |
| `acfbadd5-a6d2-4ccf-8266-7c4c76e030c5` | 404 | Absent | Same diagnostic boundary present |
| `aff6905d-edbe-45a5-ab44-e684db3a4a2c` | 404 | Absent | Same diagnostic boundary present |

Fine-grained successful access/metadata stages are intentionally absent from denied metadata, consistent with #605. New cache-match timing fields are visible, but an accepted warm cache body was not obtained. The missing articles prevent a same-content deployed body-retention/image-cache/first-paint comparison. On November 16, 2026, the change requester confirmed that no public test samples are currently available and deferred this verification until they notify production deployment. No test data was created or production content copied.

The four responses had `front_backend-fetch` approximately 1.246–2.525s, `edge_core-fetch` 0.756–1.357s, and `core_total` 0.149–0.269s. These nested spans are not additive. They justify examining binding/transport wait as well as query time on successful requests; they do not attribute a normal article's delay to a database query or justify a placement change.

## Inherited mechanism regressions on latest dev

| Command | Observed result | What it establishes |
| --- | --- | --- |
| `pnpm web -- test tests/unit/components/Article/article-hydration.spec.ts tests/unit/utils/shareCache.spec.ts tests/unit/server/shareCacheIsolation.spec.ts` | 3 files, 38 tests passed | Inherited node-ownership and cache/timing contracts remain covered; not a deployed-browser speed result |
| `pnpm api -- test test/handler/http/imageProxy.runtime.test.ts test/domain/crawlContent.test.ts test/domain/bookmarkAccessSecurity.test.ts` | 3 files, 22 tests passed | Native workerd R2/cache mechanism, capture behavior and access regressions; not a deployed cache-hit claim |

Web test setup reported missing local public configuration, Turnstile and OG/SSR warnings. The requested tests completed with a zero process exit code. No secret configuration files were read to resolve those warnings. The workerd image test exercises native R2 and Cache API locally; it does not observe the live test bucket.

## Outstanding evidence

- Successful same-content deployed articles and accepted warm HTML-cache validation. Verification is deferred until the change requester reports production deployment; test-environment sample collection is not an active request.
- Same-content browser candidate/control runs against deployed #605; complete SSR-node/processor/media/mark behavior on that environment.
- Production benefit of this follow-up. Local player-box mechanism evidence is recorded below and does not establish field LCP improvement.
- Successful whole-route first-byte attribution. The Promise-only overlap candidate has been excluded: both repositories resolve one cached request-scoped client configured with `Pool({ max: 1 })`, so no independent database connection capacity was established. No API scheduling or pool change was made.
- Production post-convergence LCP Good, browser/device/country mix and sufficient podcast/Mole counts. Deferred until the change requester promotes the appropriate build.

Do not mark #605 deployment/outcome tasks complete from this document. It records partial fresh verification and remaining gaps only.

## Deferred verification TODO

Resume this #605 verification only after the change requester notifies that the production deployment is ready. At that time:

1. Confirm the build actually serving production and allow the existing 600-second cache convergence. Start the comparison from the verified deployment, accounting for any rollback rather than assuming the merge time is the serving-build time.
2. Revisit the existing podcast, Mole, short WeChat and video-podcast canaries; verify body retention, image display/preview and cache behavior, plus highlight and podcast play/seek/resume regressions. Check new-capture sizing only where a suitable authorized existing capture is available; do not rewrite old snapshots.
3. Compare available TTFB, image-request and text-render phases, LCP and CLS, and evaluate the existing podcast/Mole 70% field contract only after sufficient post-deployment observations.

Production deliberately omits the granular diagnostic headers. Production verification can establish serving-build, browser/resource and field outcomes; it does not automatically close non-production metadata-stage attribution. Keep that evidence gap explicit without changing production settings. The existing local regression results remain valid baseline evidence and are not a same-content deployment acceptance.

## Independent planning review and reconciliation

The requested Claude Code reviewer reported `claude-opus-5.5` in both initialization and response metadata. Its first read-only exploration reached the 1,200-second limit without a final report. A bounded final pass, supplied with verified source excerpts and all proposal artifacts and with exploration tools disabled, completed successfully. This is source-and-proposal review, not an independent live performance run.

The final pass supports the stylesheet-only runtime scope and API exclusion. Its two Important planning findings and three lesser clarifications have been reconciled:

- Specify block display for both fallback host and iframe, including the inline iframe descender gap in verification.
- Match the processor's actual `.article-detail` container predicate. Source confirms that the player and marked article are siblings, and the separate generated-article slot sits outside that container. No new wrapper or processor change is required by the plan.
- Measure effective collapsed margins, host height and introduction-top delta; do not add margin declarations arithmetically.
- Verify the compiled generic minimum-height override and actual computed style.
- Keep geometry-to-LCP causation unproven until the post-#605 candidate/viewport trace establishes it. A moving already-painted paragraph is insufficient evidence.

The active-change scan found no competing `youtube-ai-article` delta outside this proposal; archived changes were excluded. The planning review found no remaining Important planning issue after these corrections; it did not review or accept the subsequent implementation. Planning-phase strict OpenSpec validation passed 134 items, zero failures.

## Approved player-layout implementation — November 16, 2026

### Runtime ownership and reproduced defect

The only production edit is in `apps/web/styles/article/_article.scss`, next to the existing generic iframe rule. Within `.article-detail.default`, the new rule matches the processor's existing container predicate (`:has([data-slax-derived='youtube-article'])`) and the native `youtube-player` fallback. It uses block layout, the existing enhanced host's 440px maximum width and `0 auto 24px` margin, and a block direct iframe with `min-height: 0`. The iframe's saved inline width and 16:9 aspect ratio remain responsible for sizing. The generated selector overrides the generic computed `400px` minimum without `!important`. No component, processor, playback event, selection adapter, capture builder, schema, API, cache or layer edge changes.

Before changing production source, the source-compiled browser fixture reproduced the defect with the full reader Sass/UnoCSS cascade, the actual `YoutubeProcessor` and actual `YoutubePlayer.ce.vue`. Only the remote YouTube API was stubbed for geometry. Chrome incognito, light/dark/e-ink, viewport widths 390/768/1440px and height 844px: 0/9 cases passed. The native host was inline, its iframe minimum height was 400px, and paragraph top moved by -174.625/-142.5/-151.5px after enhancement. Both player width and effective height changed. Text-node identity remained intact, so #605 node retention alone did not eliminate this geometry shift. Observed fixture CLS was approximately 0.11650/0.08975/0.03510; these are local mechanism values, not production metrics.

The first stylesheet attempt used `margin: 24px auto`. It passed the simple first-child cases but failed all nine cases using the previously recorded 430,837-byte video-podcast body: an additional -24px paragraph/player shift remained when a non-rendering node preceded the player. The generic `:first-child` top-margin reset had masked that difference in the simple fixture. Correcting the fallback to the existing enhanced host's `0 auto 24px` fixed the reproduced case. The permanent matrix includes both first-child and preceded-player variants.

The recorded public body was extracted from the existing November 16 investigation artifact, not fetched again or uploaded into a test bucket. Cloudflare-injected scripts were made inert in the disposable local fixture copy, preserving their sibling nodes and the article text. The stored snapshot and original investigation artifact were not changed. The historical and current builder shapes have sibling player/marked-article nodes inside the same processing container; the rule does not depend on a new capture or marker nesting.

### Running browser evidence

- Historical article body: 9/9 theme/viewport cases passed after the margin correction. Player/frame width, height, frame top and introduction paragraph top matched before/after; paragraph delta was 0px, text identity survived and all negative controls remained unchanged. Initial/final frame sizes were 358×201.375px at 390px, and 440×247.5px at 768/1440px. Total observed CLS was 0 / 0.000026 / 0.031247. The desktop total includes other processor work such as opening the existing contents list; zero player-box delta does not mean all article CLS is fixed.
- Real YouTube service: the source-compiled full-CSS fixture loaded the original native iframe, enhanced it with the real iframe API, and played the known video. Clicking the 1:05 chapter control produced visible playback at 1:07. Native/enhanced frame and introduction top matched, paragraph delta was 0px and the observed local CLS was 0. This confirms service playback/seeking, not third-party mobile/device parity.
- Source-compiled hydration/reading fixture: actual body directive, ImageProcessor, MarkRenderer, DwebEnvironmentAdapter, ImagePreview, PodcastProcessor and PodcastPlayer CE, using a real browser audio element and a same-origin 90-second WAV. Highlight drawing/clicking worked; an unrelated reactive update retained highlight, image and player identity; body writes were 0 and text/image nodes survived. Image preview opened and closed via its background and released the screen lock. The fixture now compiles the real UnoCSS directives and its `hidden`/`opacity-0` utilities so preview presentation is actually exercised.
- Podcast playback: no audio request before interaction (`preload=none`); play first started at saved 30s; the 45s body timestamp played from 45s; pause and 1.25× speed worked; ±15s controls moved the paused time from about 51s to 36s and back. Refresh restored saved 49s, and the first playing event was 49s. A fresh case with saved 30s and no prior audio request first played at 45s when the timestamp was clicked, preserving explicit seek priority over resume.

Browser observations and screenshots are retained locally under `.local/lcp-followup-plan-2026-11-16/` (`saved-player-matrix.json`, `reading-interactions.json`, `reading-resume.json`, `reading-first-seek.json`, and screenshots). These are mechanism/interaction fixtures, not authenticated Nuxt integration or deployed #605 acceptance. The synthetic matrix and final check/review results follow below.

### Limits and unchanged TODOs

The baseline paragraph already intersected the viewport. These runs establish stable initial geometry and less layout shift; they do not establish that the older late production LCP candidate was caused by movement, nor predict a percentage-point LCP gain. LCP entries in embedded matrix frames were not consistently available. A live top-level fixture reported the introduction candidate at 796ms before manual enhancement, but this single unthrottled observation is not the controlled P75 gate.

No authenticated Nuxt route, real iOS/Safari device, configured network/CPU profile, production cache-converged build or seven-day field outcome was exercised by this local slice. Those agent-executable gaps are explicit. There is no client/native-code change. The new initial-player presentation subsequently received human hands-on acceptance, recorded in the delivery acceptance section below; the earlier gap applied before that confirmation. #605 production verification, first-byte attribution and the podcast/Mole Good >=70% outcome remain deferred exactly as requested.

### Final checks

| Check | Observed result | Scope |
| --- | --- | --- |
| Final browser geometry matrix | 18/18 passed, maximum paragraph delta 0px; all text identities and negative controls retained | 3 themes × 3 viewport widths × first-child/preceded-player cases; actual source CSS, processor and CE with a remote-API stub |
| Historical saved-body browser matrix | 9/9 passed | Previous recorded video-podcast body, without recapture or deployed validation |
| Focused Web tests: `article-hydration`, `youtube.processor`, `podcast.processor`, `image.processor` | 4 files, 73 tests passed; exit 0 | Existing body/selection/media processor contracts |
| Full Web tests: `pnpm --filter @apps/slax-reader-dweb exec vitest run --maxWorkers 1 --hookTimeout 120000` | 241 files passed, 1 skipped; 2,913 tests passed, 3 skipped; exit 0 | Full affected application suite, including existing happy-dom teardown warnings |
| `pnpm web -- typecheck` | Exit 0 | Selection package build, Nuxt generated types and vue-tsc |
| ESLint for both browser fixtures | Exit 0 | Fixture imports and JavaScript lint |
| `node --check` for both browser fixtures; `git diff --check` | Exit 0 | JavaScript syntax and whitespace |
| `pnpm exec openspec validate --all --strict` | 134 items passed, zero failures | All active/living OpenSpec artifacts |

Nuxt checks used the repository CI's public localhost placeholders; no secret files were read. Turnstile/OG/site-URL warnings remain unchanged. The first simultaneous test/typecheck invocation raced in their shared selection build output (`ENOENT` during cleanup); the build commands were subsequently serialized and typecheck passed. The first unrestricted full test attempt was stopped after setup timeouts; the final bounded-worker run above passed. Neither incident required application/configuration changes.

Task status is intentionally narrower than the implementation result: 2.1/2.2 and 4.2 are complete. Full running-reader integration (2.3), configured end-to-end performance profiling (4.1), and the previously deferred deployment/field tasks remain unchecked. Local fixture success does not silently close those obligations.

### Independent implementation review

A fresh-context Codex reviewer completed Bugs, Security and Compliance passes over the complete task diff and OpenSpec artifacts. It confirmed matching processor/container ownership, first-child and preceded-player margin behavior, selector exclusions, and unchanged node/lifecycle/event/layer ownership. The initial stale task-approval wording was corrected, and a final evidence reread confirmed the 18/18 JSON and check table. No Important or Nit findings remain. This is agent review, not human hands-on acceptance.


## Draft delivery follow-up — November 16, 2026

The change requester asked to finish the previously planned non-#605 work together, verify it, and create a draft PR. The approved proposal remains the scope: player geometry is the runtime implementation; first-byte work is measurement; database scheduling/pool changes, CSS splitting, image transformations and historical snapshot repair remain excluded. The earlier request to wait for notice of production deployment is still in effect. The following is a disposition of the remaining candidates, not a claim that every underlying performance problem has been fixed.

| Candidate | Evidence rechecked for delivery | Disposition |
| --- | --- | --- |
| Remaining document TTFB | Successful metadata-stage timing is still missing. The existing four dev responses are 404s, and the request-scoped `Pool({ max: 1 })` is shared by the proposed owner/share reads. | Keep the successful hit/miss attribution TODO open. No speculative API, authorization, connection-pool or cache-freshness changes. |
| Mole image transfer | Existing three HKG probes measured the same PNG at 18,323 bytes, 1200×480; total request times were 401.7–491.7ms including connection setup. These are not matched mobile field measurements or #605 cache acceptance. | No image compression or lower-resolution preview variant. Verify #605 edge-cache behavior on the actual serving build when production verification resumes. |
| Mole CLS on the historical body | Existing saved image lacks intrinsic width/height. #605 adds dimensions to new FxEmbed captures, not historical snapshots. | No guessed dimensions, extra image-fetch boundary or stored-content rewrite. Keep the historical-body CLS measurement open; this player rule does not target it. |
| Remaining text render delay / CSS | In the existing clean video trace, all 11 stylesheet requests completed by 1679.21ms, FCP was 1822.34ms and the later text LCP was 3655.66ms. The original podcast trace completed CSS by 2882.13ms and painted text at 3052.37ms. Neither trace used the configured mobile/CPU/network profile. | CSS completion does not explain the later video candidate by itself, and these observations do not quantify a CSS-splitting benefit. No route/chunk/lazy-component changes; preserve the controlled-trace TODO. |

These decisions preserve existing architecture and the minimum runtime diff. They do not establish that CSS contributes zero time, that the image is fast for all visitors, or that production Good has reached 70%.

`origin/dev` was fetched for delivery and resolved to `73078fd349a402cf7cde40e4500702c64fc38108`. Its changes since the original #605 base concern API search/Zhihu capture, with no Web source changes. The original implementation base and earlier evidence remain identified above; no #605 code is duplicated in this diff.

The browser fixture accepts a second optional argument pointing to baseline article styles. A disposable copy of the target branch styles supplies the matched baseline; the production file is never temporarily reverted. The target baseline failed all 18 cases, establishing that the permanent matrix detects the production defect rather than merely mirroring a CSS declaration. Matching before/after native-player visuals use light theme, 390×844px, manual enhancement and the same real YouTube video.


Fresh delivery checks passed before commit: Web full suite 241 files passed / 1 skipped, 2,913 tests passed / 3 skipped, exit 0 (262.72s); Web typecheck exit 0; both browser fixtures' ESLint exit 0; both `node --check` and `git diff --check` exit 0; strict OpenSpec validation 134 passed / 0 failed. The same baseline/fixed browser matrix reported 0/18 versus 18/18 passing with maximum fixed paragraph delta 0px. Before/after visuals and both JSON reports are in `.local/lcp-followup-plan-2026-11-16/pr-delivery/`.

A fresh-context delivery reviewer found no Important runtime, Security or Compliance issue. Its single fixture bug was independently reproduced: relative baseline stylesheet arguments failed Sass import resolution. Resolving that existing CLI argument at the fixture boundary made the same relative invocation compile and start successfully. This changes no shipped code. At the end of the agent checks, human acceptance was still pending and the PR body/visuals were prepared locally. The subsequent acceptance recorded below clears that pre-PR condition.

The task commit was rebased onto target `origin/dev` at `73078fd3` without conflicts; the Web source remains identical except for this task. Post-rebase strict OpenSpec validation passed 135 items, zero failures, and the task diff passed whitespace checks. Full Web tests/typecheck above remain applicable because the target introduced no Web changes. The working tree was clean after the delivery commit.


### Delivery hands-on acceptance

- Who: the change requester, reporting their own hands-on test.
- When: November 16, 2026, before opening the draft PR.
- Environment: local browser, `http://127.0.0.1:4323/?live=1&theme=light`, source-compiled full-reader stylesheet and actual YouTube processor/custom element with the real YouTube service.
- Accepted: initial player layout; stable article position after Enhance player; playback and chapter seeking via 1:05.
- Result: the requester explicitly confirmed all listed items were normal. No further adjustments were requested.
- Limits: this accepts the implemented Web presentation. It does not close complete Nuxt integration, real mobile/Safari, controlled performance-profile or production Good-rate tasks.

Task 4.2 is complete: agent Bugs/Security/Compliance review, implemented fixture review correction, recorded human acceptance, and strict validation. The task PR may now be opened as requested. Outstanding deployment/performance tasks remain unchecked rather than being inferred from this acceptance.

## PR #605 production verification resumed — November 16, 2026

### Serving build and measurement boundary

The requester reported that #605 had reached production and resumed the deferred verification. This section records production observations, not a deployment of this follow-up. No runtime source, production configuration, capture, stored snapshot or account content was changed during verification. This evidence-only documentation update is exempt from runtime regression testing under `docs/DEFINITION-OF-DONE.md`.

- `git fetch origin main` resolved `origin/main` to `3f4b054d65f41e3784760ffb0f951b26ca6740bf`, the #623 beta-to-main merge. `git merge-base --is-ancestor 2203281e2a9f3606d0a686e2b8be34ae84fb1f99 origin/main` exited 0, confirming inclusion of #605.
- The [production Web run](https://github.com/slax-lab/slax-reader/actions/runs/43817727691) deployed that merge to `main`. Publish/cache-purge completed at **2026-11-16 06:37:50 UTC / 14:37:50 GMT+8**. The [production API run](https://github.com/slax-lab/slax-reader/actions/runs/43817727692) completed its migrate/deploy step at 06:37:16 UTC. Both succeeded.
- With the existing 600-second HTML-cache convergence allowance, use **14:48 GMT+8** as the conservative post-convergence statistics start. Do not use the earlier dev merge time or pre-convergence traffic as the before/after boundary.
- All four actual production documents reference `/_nuxt/b2AmalrF.js`. Its downloaded content contains `slax:restore-html`; the article chunk `/_nuxt/-l6gDH5g.js` contains #605's matching-HTML adoption and changed-value-only directive. SHA-256 respectively: `efd82ed557faf3e840278af259e60ad4e9ad0646be5b58b28dc03abbbdae3a7a` and `54724a2c0b176e37d0653677af48ceb6b4f037319ec12539a99849c990c4b157`. All 63 inspected preload/script assets downloaded successfully.
- [PR #624](https://github.com/slax-lab/slax-reader/pull/624) remains an unmerged draft. Its stable initial-player CSS is not part of the deployed #605 result.

### Successful same-content HTTP and image observations

Each canary received five sequential anonymous GETs in one curl process, using ordinary URLs without cache-busting or a forced purge. Request 1 established a connection; requests 2–5 reused it (`num_connects=0`). The routes were not one combined load test. These local HKG observations include network/transport effects and do not represent field percentiles or a matched pre/post experiment.

| Production canary | TTFB, requests 1–5 (ms) | Whole request, requests 1–5 (ms) |
| --- | --- | --- |
| [Original podcast](https://r.slax.com/b/ea02a6ad-22e9-49ec-bd63-1fb22bf98f75) | 1511, 373, 317, 324, 1316 | 1980, 534, 485, 498, 1439 |
| [Mole](https://r.slax.com/b/a3b123af-27fc-4d12-b329-d8c4fd26b3f6) | 1330, 338, 338, 336, 420 | 1520, 423, 403, 398, 484 |
| [Short WeChat article](https://r.slax.com/b/acfbadd5-a6d2-4ccf-8266-7c4c76e030c5) | 1389, 378, 522, 283, 312 | 1390, 409, 552, 310, 352 |
| [Video podcast](https://r.slax.com/b/aff6905d-edbe-45a5-ab44-e684db3a4a2c) | 1622, 569, 777, 335, 492 | 2046, 727, 934, 492, 652 |

All 20 requests returned 200. Each route reported `x-bcache: store` first and `hit` on the next four responses. All four initial documents omit the private snapshot manifest and use the stripped-body payload. This establishes successful public delivery and accepted warm HTML-cache responses. It does not establish low metadata latency: the podcast still had a **1316ms cache-hit TTFB**. Comparing reused warm connections against historical fresh connections would overstate a #605 speed gain.

Production returned no `Server-Timing`. The saved curl records separate DNS/connect/TLS and whole-route wait, but cannot attribute the successful wait to access checks, owner/share reads, database queries, binding transport or rendering. No diagnostic setting was enabled to close that gap.

The Mole lead image remains on `https://api-reader.slax.com/static/image`; decoding the existing `u` encoding reaches `pbs.twimg.com`, retaining a single proxy rather than making the browser request the original host. Five image GETs returned the identical **18,323-byte, 1200×480 PNG**, SHA-256 `166a055508ed3f506944fd32afb415443784b73024162d1f47101e47022c0060`. Whole-request times were **525, 241, 235, 226, 233ms**, with connection reuse after the first. Responses have `public, max-age=2592000, immutable`, but no Age, cache-status or timing signal identifying Cache API versus R2. Repeated successful/faster responses therefore do not independently prove the new R2-to-edge cache-fill path.

The historical image tag is still eager/high-priority and has **neither width nor height**. This is consistent with #605 sizing new FxEmbed captures without rewriting existing snapshots; it leaves the historical sizing/CLS concern open. No suitable newly captured canary was available, and no recapture was performed. These small-image observations do not justify adding compression or a second image variant.

### Running production browser checks

- Original podcast: play changed the control to Pause; pausing retained progress. A reload restored the paused **177s** position. The **2:29 chapter control** sought to 149s and started playback. The original observed user position, **168s paused**, was restored before leaving. No highlight, comment or bookmark was created.
- Mole: the article and lead image loaded; clicking the actual lead image after hydration opened the full-image preview overlay using the proxied URL. A screenshot is retained locally as `mole-preview.png`. Preview closing was not independently confirmed in this production pass; the test navigated away afterward.
- Short WeChat article: the heading and body rendered, with 1,111 body characters and one body image present after initialization. Video podcast: 44,327 body characters rendered, and the hydrated embedded YouTube player exposed its play control and the article exposed its timestamped contents. This is display/initialization coverage; it is not a full production playback/seek/resume test of that third-party player.
- One initial clean Chrome-incognito Mole navigation, without CPU/network throttling, displayed **LCP 2.14s (image candidate)** and **CLS 0.00** in DevTools. CLS was rounded and the panel still listed two shifts. Domain zoom was the pre-existing 75%; DevTools browser-cache disabling was enabled. No exact shift-score trace was exported. This single desktop observation neither establishes mobile P75 nor disproves the historical CLS issue.
- The configured 390×844/DPR2/CPU4×/1.6Mbps/750Kbps/150ms profile was **not completed**: native DevTools throttle controls did not reliably apply/verify the requested settings. Enabling the responsive toolbar alone was not treated as a controlled run. The temporary incognito window and the two verification tabs were closed; user-owned work tabs were retained.
- Bundle inspection confirms that the intended node-adoption code is served. It does **not** directly prove SSR text/image node identity through an individual live hydration. No pre-hydration node observer/identity trace was obtained. Authenticated persisted-highlight behavior, pre-metadata seek priority, all media controls, real iOS/Safari and the full controlled candidate timeline remain gaps. Earlier local regression evidence remains local evidence and is not relabeled as production acceptance.

### Early Web Analytics and remaining acceptance

The signed-in Cloudflare dashboard was inspected with bots excluded and an exact **14:48–14:57 GMT+8** window. Both the LCP URL chart and its Debug View were set to **15 items**. This window follows convergence and precedes the new browser experiments. The overall view is site-wide, not a podcast/Mole family filter.

- The visible LCP URL counts total **3 events: 2 Good, 1 Needs Improvement, 0 Poor** (rounded site Good 67%). The original podcast contributes the one Needs Improvement event; the other two visible URLs each contribute one Good event. Mole, short WeChat and the video-podcast canaries are absent from these visible counts.
- The dashboard shows LCP P50 1608ms and P75 3080ms. Its separate P75 subparts show TTFB 2310ms and render delay 577ms; these marginal percentiles must not be added to reconstruct an individual request or the LCP percentile. LCP Debug View returns No data for this window, so no element-level explanation was inferred from it.
- CLS Debug View includes poor/needs-improvement observations, but they were not linked to the Mole URL. They do not establish that this canary reproduced the earlier issue.

The seven-day acceptance period and minimum counts (**200 LCP events per family and 100 per primary canary**) have not accrued. Neither raw nor matched browser/device/country-mix **podcast/Mole Good >=70%** is accepted from these three events. Avoid combining this window with pre-deployment history or with the new manual tests to enlarge the denominator.

Tasks 1.2 and 3.1 are resumed but remain incomplete for the gaps above; 4.1 and 4.3 also remain open. The next evidence needed is a controlled same-content candidate/node/CLS timeline, sufficient post-convergence family data, and a successful non-production same-content sample if granular metadata attribution is required. #624 deployment must get its own later build/convergence boundary. No additional runtime optimization is justified solely by this small verification sample.

Raw local evidence is under `.local/lcp-production-605-2026-11-16/`: deployment logs, `http-summary.json`, per-request headers/HTML, `asset-signatures.json`, `mole-image.json`, image responses, podcast pause/resume/seek observations, `video-dom.txt`, the preview screenshot and the dashboard accessibility snapshot. Raw account-dashboard content remains local and is not included in git or published attachments. These artifacts support the observations above; they are not a reusable production monitoring service.

Evidence-document checks: `pnpm exec openspec validate --all --strict` passed 135 items, zero failures, exit 0; `git diff --check` passed. Bugs/Security/Compliance review found no Important issue in this documentation-only update; it introduces no new behavior or package output. No runtime tests were rerun or claimed as fresh production evidence.

### Coverage reconciliation and document TTFB scope

The requester asked whether the remaining TODOs imply implementation missing from #605/#624, and authorized adding a justified related correction to the still-open #624. Source and evidence review found no additional confirmed runtime defect with a demonstrated minimal correction in this pass. The remaining items have different dispositions:

| Item | Implementation coverage | Disposition |
| --- | --- | --- |
| Unchanged-body SSR adoption, highlight/preview/podcast preservation | #605; local mechanism regressions exist | Remaining live node-identity, authenticated and device checks are verification gaps, not an identified code patch. The partial production pass does not replace them. |
| Image Cache API fill on eligible R2 hits | #605 | Live source-of-cache attribution is unverified; faster repeat requests alone do not establish an omitted implementation. |
| Stable edited-YouTube initial player box | #624 | Implemented and locally accepted, but not deployed. Keep its production verification separate. |
| Historical Mole image dimensions / CLS | #605 covers new exact-cover FxEmbed captures; neither PR repairs old snapshots | A remaining candidate, not a confirmed cause of all observed shifts. The public historical tag lacks dimensions; no measured general pre-paint repair is established. No hardcoded URL/ratio, extra image fetch on document delivery or snapshot rewrite is added. |
| Remaining document TTFB | #605 timing instrumentation; #624 successful-request investigation | Successful non-production measurements are now recorded below. No database scheduling, pool-size, placement or metadata-cache optimization was implemented; the exact cause of the platform/invocation residual remains unproven. |
| Podcast/Mole Good >=70% | Post-deployment acceptance | An outcome requiring sufficient comparable traffic, not a missing code block or a checkbox satisfied by deployment. |

Document TTFB is the wait until the first HTML response byte, including connection/transport and server work; article hydration and subsequent image transfer occur afterward. On an accepted anonymous HTML-cache hit, the existing call chain is:

`Web share-cache -> Cache API match -> matchesCurrentSnapshot -> BACKEND ContentEntry -> CORE content/meta -> ContentOrchestrator / services / repositories -> role + complete metadata revision comparison -> cached HTML body`.

The cache avoids the normal authorized R2-body/projection/SSR route on an accepted hit, but does not eliminate the fresh metadata request. That validation preserves current sharing/revocation, policy and presentation. It must not be skipped or made stale merely to lower TTFB. This HTML-cache behavior predates #605; its newly observed `store`/`hit` results are not a new #605 query optimization.

#605 adds fixed-name timing at cache-match/validation/body, bookmark/owner/share/media access and trace/fork/PDF/collection boundaries, retaining the existing query order and exposing diagnostic headers only outside production. Its eligible R2-hit edge fill reduces repeated **image** origin/storage work; it is not a document metadata optimization. Its client SSR-node adoption and #624's CSS act after HTML delivery and do not directly shorten document TTFB.

The owner/share Promise-overlap candidate remains rejected: the two repositories resolve the same request-cached Hyperdrive Prisma client, whose pool has `max: 1` (`apps/api/src/di/data.ts`). Moving those calls into `Promise.all` would still queue their queries on that connection and change denied-path/error behavior without a demonstrated latency saving. No additional client, pool connection, batching abstraction or cache policy is introduced to rescue that candidate.

This follow-up adds documentation and production evidence to #624 only. Its existing 11-line article stylesheet runtime diff, approved layout requirements and visual acceptance remain unchanged. The PR description must distinguish inherited #605 production observations, #624 local player-box results, and unresolved attribution/field acceptance.

## Successful test-article first-byte attribution — November 16, 2026

### Obtaining normal successful requests without creating data

The four production UUIDs still were not suitable test-environment samples. Instead of treating those 404s as the only available route, a read-only request to `https://r.slax.dev/sitemap.xml` followed its published redirect to `sitemap_index.xml`, then the linked `__sitemap__/collection.xml`. That sitemap exposed the existing public collection `/c/f5b7838cac33fa2703e1b0fd482c6107`, whose rendered links supplied two real saved articles:

- [Swift SDK article, with a visible saved-highlight count](https://r.slax.dev/b/61776283-0e16-4a4e-bfd2-7467a09f395e).
- [PowerSync Update: May 2025](https://r.slax.dev/b/69c1e5b2-15d4-4ccc-b00f-22efa9fb461a).

Both returned complete successful article documents. The Swift content endpoint returned role `visitor`, the expected title and 24,226 body characters. An exploratory collection link labeled E2E-renamed was excluded from normal-article acceptance. No test bookmark, account, snapshot or production copy was created, and no secret file was read.

These are different saved test articles, not the production podcast/Mole canaries. They exercise the successful normal metadata/access route and do not close task 1.2's same-content checks or establish family LCP performance. The displayed saved-highlight count was used to select a control, not to claim fresh highlight interaction verification.

### Five repetitions at each existing diagnostic boundary

Three sequential groups used ordinary anonymous curl GETs with compression, no cookies/authentication, no cache-buster and no forced purge. Each group used one curl process for five requests, establishing one connection first and reusing it for requests 2–5. The Swift document had already been stored by the initial successful probe; its five measured responses were all HTML-cache hits. The Update document reported store then four hits. The Swift `/api/content/<uuid>` route uses the existing `loadContent` path and intentionally does not take the document HTML-cache shortcut.

All 15 requests returned 200 and included the existing non-production diagnostics. Durations below are rounded milliseconds, in request order; these are small local HKG samples, not field percentiles or controlled mobile budgets.

| Route, five requests | TTFB | Whole request | Core total |
| --- | --- | --- | --- |
| Swift `/b/61776283-…` | 1027, 340, 336, 376, 295 | 1027, 341, 337, 377, 296 | 457, 27, 23, 30, 23 |
| Update `/b/69c1e5b2-…` | 1865, 393, 337, 333, 824 | 1865, 395, 338, 334, 826 | 489, 69, 25, 22, 479 |
| Swift `/api/content/61776283-…` | 2944, 404, 374, 409, 356 | 2945, 408, 375, 409, 357 | 568, 22, 15, 18, 15 |

Descriptive TTFB median / nearest-rank P75 for these five-request groups are respectively **340/376ms**, **393/824ms** and **404/409ms**. Whole-request median/P75 are **341/377ms**, **395/826ms** and **408/409ms**. The tiny groups and mixed connection/cache states cannot accept a population P75 budget, prove a speed gain or predict Good >=70%.

The headers expose `core_access-bookmark`, owner/share/media checks, `core_trace`, fork/PDF/collection, `core_total`, `edge_core-fetch`, and frontend cache-validation or backend-fetch plus R2 phases. On an accepted document hit, R2-body retrieval is absent. During the initial Update store request R2-get alone was **761ms**, so first object retrieval is another contributor on that path. The direct content group had R2-get approximately 59–75ms. Body projection, response serialization and cleanup reported approximately zero. As clarified in the November 17 follow-up, deployed Workers timers advance on I/O and cannot measure synchronous CPU work; these readings neither establish negligible CPU cost nor identify a CPU-heavy HTML transform.

An additional five independent curl processes forced **new connections** to the same already-cached Swift document without changing its URL. TTFB was **961, 3748, 2079, 867, 552ms**, while TLS completion was **392, 232, 221, 217, 221ms**. The 3748ms request had **2884ms cache validation**, **1808ms edge core-fetch**, and **534ms Core total**. This reproduces a large backend-call residual on a cache hit and rules out attributing that whole wait to TLS or HTML/body transfer. It does not prove a new browser connection causes a slow server invocation.

### Temporary Edge/Core tails and same-window comparison

The signed-in dashboard verified the actual test Edge binding `CORE -> reader-core` in the test account; no misdirected service target was observed. Both test and production Core runtime panels showed Placement Default. Worker Logs were enabled and persisted, but invocation logs and traces were disabled; the dashboard Live query did not supply the anonymous metadata invocations. No observability or placement setting was changed.

The existing Wrangler OAuth session had workers-tail read permission. Temporary raw tails against test `reader-backend` and `reader-core` were therefore used, without reading the CLI credential file. Capture retained only metadata-invocation timestamps, outcome/status, CPU/wall time, field shape and redaction status. Request headers, bodies, console content and unrelated invocation payloads were not retained. Wrangler tail's explicit sampling-rate value 1 was rejected by this installed CLI; removing the optional sampling flag established the stream. Tail subscriptions and their owned local processes were stopped afterward.

Cloudflare redacted the `uuid` value. Consequently, the five rows below associate events by sequential request order, a non-overlapping recorded client start/end window containing exactly one successful metadata event per worker, and consistent durations/status. They are **temporal associations, not exact request-ID traces**. A prior three-request Core-only observation had CPU 177/263/34ms and wall 648/781/484ms; it was not substituted for the paired experiment.

Five further ordinary Swift content-API requests, each with a new connection, produced:

| Request | TTFB | Front backend-fetch | Edge core-fetch | Core total | Edge CPU / wall | Core CPU / wall | Core timestamp after Edge |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1063 | 548 | 537 | 486 | 1 / 537 | 56 / 525 | 9 |
| 2 | 2790 | 2047 | 1412 | 613 | 0 / 1411 | 182 / 728 | 630 |
| 3 | 1187 | 622 | 611 | 581 | 0 / 611 | 32 / 603 | 6 |
| 4 | 1079 | 488 | 476 | 440 | 1 / 478 | 39 / 468 | 5 |
| 5 | 1018 | 424 | 421 | 388 | 0 / 421 | 37 / 417 | 2 |

In request 2 the application Core stages were access **370ms**, trace **181ms**, collection **62ms** (Core total 613ms); R2-get was **68ms**. Frontend backend-fetch exceeded edge core-fetch by **635ms**, and edge core-fetch exceeded Core total by **799ms**. These are same-request nested-interval differences, not sums of marginal percentiles. The temporal tails also place a **630ms** interval between Edge and Core invocation timestamps while Edge CPU is 0ms. The evidence supports substantial invocation/call wait outside the measured Core handler on the slow request, alongside real Core repository/driver wait. It does not establish a 2–3-second SQL execution, a fixed network-hop cost, or a single global bottleneck for all requests.

Hyperdrive's existing 24-hour dashboard view showed test average query/connection latency about **15.32/1.8ms**, and production query latency about **9.04ms**; test waiting clients displayed 0. These are aggregate pool-side metrics for all workloads, not this request's SQL spans. They cannot distinguish its database execution from driver setup, cached-query behavior, transport or queueing. Both configurations had cache-hit observations, so consecutive hot repeats must not be treated as a representative traffic mix.

### Offline startup hypothesis check

To check initialization without live deployment or database access, the current Core/Edge entrypoints were bundled with `wrangler deploy --dry-run --outfile <multipart>` using temporary public-only configurations in the API package and its existing TypeScript/CompiledWasm/compatibility settings. The actual private API configuration was not read. The temporary configurations contained no variables or resource bindings and were removed after use. These diagnostic bundles are not asserted to be byte-identical to a deployed, privately configured release.

The pinned Wrangler startup wrapper did not forward its outer config into its inner build and initially selected the wrong build path; out-of-package tsconfig resolution also failed. Inspecting the installed wrapper and following the existing repository build pattern resolved collection: build the multipart explicitly from the API package, then run `wrangler check startup --workerBundle <multipart> --outfile <cpuprofile>`. No CLI upgrade or shipped tooling change was made.

- Core diagnostic bundle: 20,615KiB uncompressed / about 6,534KiB gzip. An initial profile overlapped the Edge build and is not used as the serial reading. A subsequent isolated profiling invocation showed **190.6ms active sampled time**, a **320.2ms profile window**, and 9.0ms garbage collection.
- Edge diagnostic bundle: 20,756KiB uncompressed / about 6,574KiB gzip. Profiling after its build completed showed **187.1ms active sampled time**, a **326.4ms profile window**, and 6.0ms garbage collection.

Initialization is observable and distributed through a large module graph; the samples did not identify one demonstrated small source correction explaining the online residual. Local hardware, profiler sampling, omitted bindings and build configuration differ from Cloudflare serving conditions. These results neither equate local startup to the online 630ms timestamp gap nor establish a benefit from broad lazy-loading, entrypoint splitting or moving service responsibilities. The offline profiles and the unsuccessful collection attempts are retained locally, with no startup-speedup claim.

### Attribution result and runtime decision

Task 3.1's successful-request application-boundary measurements are now available. The largest slow-request residual is before/around worker invocation and is not removed by owner/share Promise scheduling. Core repository timings also differ substantially across repetitions; their awaits include driver initialization, connection/transport, cache behavior and query work, rather than database execution alone. Repetition order does not establish isolate cold/warm state.

No demonstrated minimal runtime correction was selected from these observations. In particular, no layer is bypassed, metadata authorization/revision is not weakened, and no pool enlargement, stale metadata cache, guessed SQL rewrite or forced placement is added. The [service-binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/) describes normal bindings as colocated, so the measured residual is not evidence that the existing layer count inherently adds a permanent remote hop. [Workers startup guidance](https://developers.cloudflare.com/workers/platform/limits/) identifies global initialization and bundle size as possible startup costs; **startup remains a hypothesis here**, not an observed cause or an implemented fix.

The remaining physical attribution is to separate initialization/loading, platform scheduling/dispatch and other uninstrumented wait, then demonstrate a bounded correction before changing runtime behavior. Existing timers and query-redacted tails do not provide that unique cause or per-query database execution spans. No provider tracing was enabled and no alternate candidate was deployed, so no twenty-pair before/after speedup or production benefit is claimed. Original production same-content, controlled LCP/TTFB, full reader integration and seven-day Good-rate tasks remain open.

Raw local evidence is under `.local/ttfb-attribution-2026-11-16/`: normal/fresh/correlated/paired curl metrics and response headers, public response bodies, minimized Core/Edge tail records, `paired-summary.json`, selected runtime/binding observations and aggregate Hyperdrive metrics. The disposable collectors are not shipped tooling or a new monitoring service. This update changes documentation only; the 11-line #624 stylesheet and its acceptance remain unchanged.

Documentation-only follow-up verification: `pnpm exec openspec validate --all --strict` passed all 135 items, and `git diff --check` passed. No application runtime file changed in this follow-up, so application tests and new UI acceptance are exempt under the documentation-only rule; earlier runtime results remain explicitly scoped above. Local pre-push Bugs/Security/Compliance review found no Important findings: measured waits are not mislabeled SQL or proven cold starts, no secrets or raw tail payloads are committed, and the evidence-only scope matches `reduce-public-article-lcp-delays` without claiming the outstanding field outcome.


## Native call-chain attribution and next-morning RUM — November 17, 2026

### Timer interpretation and fresh controls

[Cloudflare's timer documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/) states that deployed performance.now() and Date.now() advance after I/O, not during synchronous execution. The fixed #605 stages remain useful for awaited operations, but a zero-duration serialization/projection/context stage does not establish zero CPU cost. Subtracting nested Server-Timing values cannot by itself identify the physical location or cause of every unmeasured millisecond. Earlier time-window tail associations are not upgraded into exact traces retroactively, and cross-worker event timestamps alone are not queue-duration measurements.

The initial successful Swift content request, before online CPU profiling, reproduced **3919.9ms TTFB**: frontend backend-fetch 3156ms, edge core-fetch 2060ms and Core timer 513ms. Temporally associated tails showed Edge CPU/wall 0/2060ms and Core 119/592ms. Twelve further requests during a profiling window included TTFB 3497/3210/3184ms outliers; profiler activity is a confound, so that group is not an uninstrumented performance baseline. Five later document requests returned 200, with TTFB **2150, 918, 900, 3736, 859ms**; the 3736ms response was an HTML-cache hit and had Core timer 521ms. The effect is therefore not limited to the uncached content endpoint or to the profiling window.

Twelve unprofiled content-API controls also returned 200 and each had one temporally associated Web, Edge and Core tail event. TTFB ranged **647–1212ms**, median 915.5ms. Web CPU was **3–12ms**, Edge **0–1ms**, and Core **24–45ms**. Frontend backend-fetch ranged 171–671ms, edge core-fetch 169–635ms and Core timer 143–634ms. These controls did not reproduce the large invocation residual; fresh client connections and repetition order do not establish isolate identity or cold/warm state.

A native 10-second CPU capture completed against an already-loaded Core isolate. The UI showed 82ms of samples, 81ms garbage collection and 1ms idle, with no request linkage or useful metadata-handler stack. [Native profiling targets an already-loaded isolate](https://developers.cloudflare.com/workers/observability/profiling-in-production/), so this capture cannot diagnose cold initialization or establish garbage collection as the slow request's cause. The browser download-event wait timed out; no raw pprof download is claimed.

### Exact native trace, with authorized temporary test configuration

The requester explicitly authorized temporarily enabling Cloudflare native Traces on test reader-backend and reader-core, then restoring both to disabled. Only the test account 52bb95cdad45ee5441e67b3a1e9dce5b was changed. Both already had Logs enabled/persisted, Invocation logs unchecked and 100% log sampling; those values were preserved. Traces were enabled and persisted for one bounded pass at the existing 100% trace rate. No source, business behavior, production configuration, placement, binding, credential or telemetry-export destination was changed. Both Traces switches were subsequently observed **false**, with zero unsaved changes. The temporary tail collectors also terminated and no owned tail process remained.

Twelve sequential ordinary requests alternated the existing Swift content API and cached document. All returned 200. Request 11 (zero-based index 10), at **09:05:40 GMT+8**, had **4851ms client TTFB**, 205ms TLS completion, 3699ms frontend backend-fetch, 2054ms edge core-fetch, 555ms Core timer and 328ms R2-get. Its curl CF-Ray **a5bad417986285e9-HKG** exactly matches the Edge and Core native trace attributes; this association does not rely only on a time window or the redacted UUID.

[Slow native trace b3c42bb22b67b8874030097c5600e6d4](https://dash.cloudflare.com/52bb95cdad45ee5441e67b3a1e9dce5b/workers/services/view/reader-backend/production/observability/traces/b3c42bb22b67b8874030097c5600e6d4) has these linked spans, all on November 17, UTC:

| Native span | Start | End | Duration | Invocation CPU / wall |
| --- | --- | --- | --- | --- |
| Edge ContentEntry invocation | 01:05:41.487 | 01:05:45.168 | 3681ms | 1 / 2054ms |
| Edge service fetch, parent 80f1cc424d1abfcf | 01:05:43.114 | 01:05:45.168 | 2054ms | Not a separate invocation |
| Core invocation, parent 4edb063ab985b937 | 01:05:43.118 | 01:05:45.063 | 1945ms | 157 / 659ms |
| Core hyperdrive_connect, parent 5b7b2db80379674c | 01:05:44.508 | 01:05:44.508 | 0ms | Not SQL execution timing |

Both invocation attributes report **HKG / APAC**. The trace has a **1627ms prefix before Edge's outgoing service fetch**, and a **1390ms Core prefix before the first recorded Hyperdrive connect operation**. Core's invocation span starts only 4ms after the Edge fetch span starts. This establishes a same-region linked call and large pre-operation prefixes; it does not support blaming a permanent cross-region Web/Edge/Core hop or treating the entire wait as SQL. The Core prefix is not asserted to be exclusively outside JavaScript, and the zero-duration Hyperdrive operation is not a measurement of all database work.

The frontend's 3699ms backend-fetch is close to Edge's native 3681ms invocation span, whereas Edge's I/O timer is 2054ms. Thus the apparent frontend-versus-Edge timing residual substantially belongs to the Edge invocation's pre-fetch prefix, not a demonstrated Web-to-Edge network transfer. Core likewise has 1945ms native span versus 555ms application timer. CPU/wall, native span duration and first-response time have different scopes and are not interchangeable clocks.

The adjacent cached-document request had matching Ray **a5bad43609f61096-HKG** and [trace d04b0aa309953d83df42018c9920459f](https://dash.cloudflare.com/52bb95cdad45ee5441e67b3a1e9dce5b/workers/services/view/reader-backend/production/observability/traces/d04b0aa309953d83df42018c9920459f). Client TTFB was 881ms; Edge invocation, service fetch and Core invocation spans each displayed 372ms. Edge CPU/wall was 0/402ms, Core 39/401ms. Core used the same bf4b5467 version and HKG region as the slow request. Native spans can therefore differ from JavaScript-context wall time even in the opposite direction; wall time also includes work after first response. These are adjacent successful observations, not a controlled cold/warm experiment.

**What remains unproven:** the collected native fields contain no isolate identity or cold-start marker. Invocation sequence number orders telemetry within an invocation; it is not an isolate request counter. Large bundle/global initialization and platform loading/scheduling remain competing explanations for the prefixes. Same version, same region, a new client connection or the eleventh request in a series does not distinguish those explanations. The existing offline source-bundle profile cannot allocate the observed serving delay between them. No startup-speedup or provider scheduling fix is claimed; a controlled isolate-lifecycle measurement or provider-side startup/dispatch evidence is still required before choosing that correction.

No runtime optimization was selected from this pass. Existing application query/driver work still contributes hundreds of milliseconds, but does not explain the whole native trace. The evidence does not justify bypassing layers, enlarging the pool, weakening metadata validation, introducing retries or splitting entrypoints in this PR. The owning layers, media behavior and existing 11-line stylesheet remain unchanged.

### Production field window at the next-morning review

The dashboard was read with bots excluded, last 24 hours, and both LCP URL and LCP Debug View limits set to 15. It displayed **53% Good / 21% Needs Improvement / 26% Poor**, LCP P75 4092ms, INP Good 95% and CLS Good 94%. This covers the whole slax.com site tag, including non-reader pages. It is not the podcast/Mole acceptance population. Adding a Path-equals filter for the new podcast displayed no CWV data despite the overall URL chart and the API returning that metric path; that filtered dashboard result is not used as evidence of absent events. Direct GraphQL metric-path and raw-event queries provide the per-article record below.

Read-only GraphQL queries used the existing owner-authorized credential helper without printing or committing credentials. The frozen reporting cut is **November 17, 08:40 GMT+8**. The rolling 24-hour window starts November 16, 08:40, and mixes deployment states. The conservative #605 post-convergence window is **November 16, 14:48 through November 17, 08:40**: 17h52m, not a full 24 hours. A preceding equal-duration window is retained only as descriptive context. Production received no diagnostic headers, trace enablement or configuration changes in this pass.

| Population | Good / LCP count | Good rate |
| --- | --- | --- |
| Whole site tag, rolling 24h, Cloudflare aggregation | 247 / 468 | 52.8% |
| r.slax.com article paths, rolling 24h | 97 / 255 | 38.0% |
| r.slax.com article paths, post-convergence | 79 / 217 | 36.4% |
| Identified podcast/Mole cohort, post-convergence | 20 / 67 | 29.9% |

All 217 post-convergence article LCP events were returned by the raw query (262 including the preceding equal-duration window, below the 1000 limit), with sampleInterval 1. Some whole-site aggregate groups have adaptive sampling, so the whole-site count is not labeled an unsampled census. Public rendering was inspected for all 28 article paths with positive post-convergence LCP counts. Three contained the existing podcast article structure and one was the Mole article; the four-URL cohort above is explicit and does not establish a permanent exhaustive taxonomy of all podcast content. Of its 67 events, 56 were mobile. Field traffic may include earlier desktop diagnostic visits; no individual real-user identity or visitor exclusion is claimed.

| Post-convergence article | Good / count | LCP P75 | TTFB P75 |
| --- | --- | --- | --- |
| [New WeChat: AI-era restart](https://r.slax.com/b/11c751ee-968f-4e70-bd1d-026b10b824b1) | 48 / 120 (40.0%) | 5203ms | 3837ms |
| [New podcast: 2C/2B Agent discussion](https://r.slax.com/b/c5763ff7-67fd-4ac3-8740-2d713c81c1eb) | 17 / 55 (30.9%) | 5657ms | 4859ms |
| [Original podcast](https://r.slax.com/b/ea02a6ad-22e9-49ec-bd63-1fb22bf98f75) | 0 / 7 | 8768ms | 4921ms |
| [Mole](https://r.slax.com/b/a3b123af-27fc-4d12-b329-d8c4fd26b3f6) | 0 / 2 | 5984ms | 4337ms |
| [Earlier video podcast](https://r.slax.com/b/aff6905d-edbe-45a5-ab44-e684db3a4a2c) | 3 / 3 | 2333ms | 1956ms |

The two new leading URLs account for 175/217 article LCP samples and 110/138 non-Good article samples. They materially change the workload mix. The same identified four-URL cohort had only 5/22 Good in the preceding equal-duration window; neither its raw rise to 20/67 nor the whole-article rate's decline from 20/45 to 79/217 is a matched-mix causal estimate of #605. Small canary counts, different articles/devices/regions and less than one complete post-deployment day prevent acceptance of the seven-day 70% contract.

The new WeChat LCP is a paragraph in 113/120 events; its 72 non-Good events include **48 with TTFB already above 2500ms**. The new podcast LCP is its introduction paragraph in 48/55 events; **31/38 non-Good events already exceed 2500ms in TTFB**. All seven original-podcast LCP candidates are introduction paragraphs, and five have TTFB above 4000ms. This is direct per-event evidence for prioritizing document delivery; the P75 subparts are not summed. CSS/player stabilization alone cannot repair samples whose HTML has already used the entire Good LCP budget. On Mole's desktop image event, image load duration was 170ms; its mobile text event had TTFB 4337ms and render delay 1648ms. These two observations do not establish that all historical Mole image/network problems disappeared.

Metric-path-specific CLS data has Mole **2/2 Good, P75 0.097**, the original podcast **4/6 Good with 2 Poor, P75 0.262**, and the new podcast **22/25 Good with 3 Needs Improvement, P75 0.078**. Two Mole samples cannot close its historical CLS defect. The short WeChat canary acfbadd5 had one Good LCP event (57ms), with timeToFirstByte -1, navigationType navigate and deliveryType unknown. That invalid TTFB value is not a measured negative duration, and the single event cannot establish improved fresh-document first-byte delivery or a specific cache/navigation mechanism. #624 is still an unmerged draft and its stylesheet is not included in these production figures. The observed cohort is below 70%, and the acceptance observation period/minimum counts remain incomplete.

Local artifacts are under .local/ttfb-attribution-2026-11-17/ (headers, request windows, minimized tails, native-trace-evidence.json) and .local/analytics-review-2026-11-17/ (frozen GraphQL queries/results, raw events and public-article classification). Native trace links have provider retention limits; the numerical record above stands alone. This follow-up is documentation only, with no new runtime or package output, and requires no new UI acceptance/version decision. Fresh `pnpm exec openspec validate --all --strict` passed all 135 items and `git diff --check` passed. Local pre-push Bugs/Security/Compliance review has no remaining Important findings: final evidence reconciliation corrected the short-canary absence claim to its actual single Good event with invalid TTFB; the Ray/span association and rates were checked against captured evidence, timer zeros and invocation sequence numbers are not claimed as CPU/cold-start proof, temporary settings are restored, and no runtime scope or acceptance claim was expanded. Application tests were not rerun locally for this documentation-only follow-up; the existing runtime evidence remains scoped above.

## Module lifecycle and handler-entry attribution — November 17, 2026

### Authorized scope and collection

The requester explicitly authorized minimal temporary diagnostics in the test environment, with restoration after measurement. Only account `52bb95cdad45ee5441e67b3a1e9dce5b`, test `reader-backend` (Edge) and `reader-core` were changed. Production Workers, database contents, runtime source in this branch and application configuration files were not changed.

Disposable local tooling reused the installed Wrangler authentication/HTTP implementation. It downloaded the current deployed JavaScript/Wasm modules, retained their business bytes and named exports, and added a thin entry wrapper. A lazily generated random module nonce and observed-handler counter were logged at handler entry and appended to the existing content response's Server-Timing. The Edge ContentEntry wrapper delegates to the original superclass; fetch/default queue/scheduled handlers delegate to their original implementations. The wrapper records only diagnostic scope, nonce, ordinal and handler name. It adds no user/content/authentication data to its own logs. Existing native telemetry retains its usual URL metadata in the user's Cloudflare account.

The nonce identifies a JavaScript module instance, **not a provider-issued isolate ID**. Ordinal 1 means the first wrapped handler observed in that module; it does not account for unwrapped Durable Object activity or identify every runtime lifecycle event. Static imports complete before the wrapper executes, so this diagnostic cannot time synchronous module evaluation directly. The two passes use the same existing public Swift SDK article and sequential ordinary anonymous GETs to `/api/content/61776283-0e16-4a4e-bfd2-7467a09f395e`, each through a fresh curl process. This exercises Web -> Edge ContentEntry -> Core metadata plus the existing body retrieval, rather than bypassing a layer.

The first 24-request pass had lifecycle logs and headers, but no native spans: version-upload metadata alone did not effectively enable tracing. A second 16-request pass explicitly enabled native test Traces and verified that setting before sampling. These are distinct passes; no native spans are claimed for the first one. All **40 requests returned 200**. In each pass, six distinct Core instances and six paired Edge instances had ordinal 1; later observations reuse those nonces. These are controlled diagnostic deployments, not a measurement of production cold-instance frequency.

### First observed calls versus reuse

All durations below are milliseconds. Differences between nested application waits describe boundary residuals; they are not sums of independent operations or isolated SQL/CPU measurements.

| Pass / group | Requests | Client TTFB min / median / max | Web backend-fetch minus Edge core-fetch min / median / max | Edge core-fetch minus Core total min / median / max |
| --- | ---: | ---: | ---: | ---: |
| Lifecycle only, first observed | 6 | 3451 / 3791 / 4753 | 1039 / 1508 / 1656 | 1047 / 1175 / 1903 |
| Lifecycle only, reused | 18 | 510 / 914 / 1251 | 1 / 3.5 / 7 | 21 / 26.5 / 38 |
| Native tracing enabled, first observed | 6 | 3272 / 3555 / 4637 | 911 / 1285.5 / 1743 | 916 / 1183 / 1821 |
| Native tracing enabled, reused | 10 | 843 / 915 / 1095 | 2 / 4 / 5 | 21 / 27 / 50 |

This directly distinguishes first-use versus module reuse for these probes, unlike the earlier repetition-order inference. It does not isolate startup as the only changed factor: database/driver state can also warm, instances are provider-selected, the sample is small and deployments temporarily invalidate the module population. The large boundary residuals disappear independently of the remaining Core business/transport wait. The remaining reused-call TTFB still warrants analysis; it is not zero or all platform overhead.

### Matched native trace and lifecycle logs

Request 2 in the tracing pass returned 200 with client TTFB **3664ms**, Web backend-fetch **3199ms**, Edge core-fetch **1456ms**, and Core total **540ms**. Client Ray `a5bb1aa89fb75c88-HKG` matches [trace 44e801d09853e0952196d7584472b422](https://dash.cloudflare.com/52bb95cdad45ee5441e67b3a1e9dce5b/workers/services/view/reader-core/production/observability/traces/44e801d09853e0952196d7584472b422). All linked Worker invocations are HKG.

| Native event / diagnostic log | UTC time | Observation |
| --- | --- | --- |
| Edge ContentEntry invocation starts | 01:53:51.497 | Native first-response span is 3193ms; Edge CPU 1ms, wall 1456ms |
| Edge handler-entry lifecycle log, ordinal 1 | 01:53:53.234 | Module nonce `70ab6ca5-7379-4b77-8ad3-e8c59c33ef12` |
| Edge outgoing Core fetch starts | 01:53:53.234 | Span ends 01:53:54.690, duration 1456ms |
| Core invocation starts | 01:53:53.238 | Only 4ms after the outgoing fetch begins |
| Core handler-entry lifecycle log, ordinal 1 | 01:53:54.093 | Module nonce `5d9f3605-4bf6-4f81-a8cc-7597d3197fa7` |
| Core first recorded Hyperdrive operation | 01:53:54.093 | Its zero-duration connect span is not SQL execution time |
| Core response / Edge response | 01:53:54.633 / 01:53:54.690 | Core invocation span 1395ms, CPU 84ms, wall 596ms |

The Edge native prefix to handler entry is **1737ms**; the Core native prefix to handler entry is **855ms**. These occur before the wrapper delegates to business handlers. The Core first recorded database operation shares the entry-log timestamp, subject to frozen JavaScript clocks; no zero synchronous CPU claim follows. This makes owner/share query scheduling an unsupported explanation for those particular prefixes. The 4ms native fetch-to-Core-start separation also does not support a second-long inter-Worker network hop in this request.

Request 4 reuses **both exact module nonces at ordinal 2**, with client TTFB **843ms**, Web backend-fetch **384ms**, Edge core-fetch **380ms**, and Core total **357ms**. Its Ray is `a5bb1ad4e85add55-HKG`, [trace 96abeffd6c44e77af680a01871335e84](https://dash.cloudflare.com/52bb95cdad45ee5441e67b3a1e9dce5b/workers/services/view/reader-core/production/observability/traces/96abeffd6c44e77af680a01871335e84). Edge entry log and outgoing fetch both start at 01:53:58.580; Core invocation and entry log begin at 01:53:58.581. Core's native first-response span is 357ms with CPU 27ms and wall 377ms; the Edge first-response span is 380ms. The large Core pre-handler prefix is absent on this reuse. Native tracing's separate start/span, CPU and wall measurements are retained separately, rather than reconciled by invalid subtraction.

### Startup evidence and remaining platform limit

Cloudflare's diagnostic version-upload responses reported `startup_time_ms` **441ms for Core** and **402ms for Edge**. The uploaded business entrypoints are already minified: index.js is 8,984,253 bytes in Core and 9,069,493 bytes in Edge, plus their existing Wasm modules. This corrects the applicability of the earlier unminified offline source-bundle sizes: that offline profile was not the deployed release artifact. The Jieba Wasm initializer in the current source is already deferred to its Durable Object's initialize path; blindly making it lazy again is not a demonstrated correction.

Upload validation startup is measured outside these serving requests. It cannot be subtracted from the 1737ms/855ms native prefixes to label the remainder platform scheduling, and the reported upload values are not the sum of each request's actual startup and dispatch costs. The collected native attributes expose no isolate creation time, code-load start/end, module-evaluation start/end or runnable-queue delay. Handler JavaScript cannot observe its own pre-handler scheduling; Date.now/performance.now also do not measure synchronous CPU reliably in deployed Workers. The already-loaded-isolate CPU profiler cannot supply missing historical startup spans.

**Attribution outcome:** the large residual is now localized to first observed module use and before handler entry, with measured startup cost as a plausible contributor. Actual serving module loading/initialization versus platform provisioning/scheduling remains inseparable with the fields available here. Generic platform slowness on reused modules was not reproduced in these boundary residuals, but platform work specific to starting a new instance remains possible. No single responsible import or source change with demonstrated live benefit was identified. Task 3.3 stays open; no speculative lazy-loading, entrypoint split, pool/placement change, cache bypass, preload traffic or retry is added to #624.

The earlier 1627ms Edge and 1390ms Core prefixes were recorded without lifecycle markers. The new experiment reproduces a similar pattern and strengthens the first-use hypothesis, but cannot retrospectively prove those earlier invocations were first use or assign their entire gaps to script initialization. [Native span attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/), [startup limits](https://developers.cloudflare.com/workers/platform/limits/) and [frozen runtime timers](https://developers.cloudflare.com/workers/runtime-apis/performance/) describe different measurement boundaries; none supplies the missing per-request platform queue duration here.

The remaining provider-side investigation can use the UTC timeline, matching Rays, trace links, diagnostic version IDs and paired first/reuse module observations above to request code-loading/evaluation and queue timestamps from Cloudflare. This record prepares that investigation; no external support message was sent.

### Restoration and verification

The original 100% test versions were Core `bf4b5467-3b9f-4831-a691-03688c1a1d6b` and Edge `f5f98b05-271c-4e94-8463-a4c44a198291`. The tracing pass uploads were Core `49a759a7-3452-4ace-875b-f73fcb2d2618` and Edge `f5025166-eafc-4b69-b9a1-15ac9ca0470b`; explicitly patching observability created the actual traced versions Core `25ef00ba-b88d-4768-8057-9dbc7359d0c5` and Edge `ccc4c020-843a-426f-b982-895919f8ac55`, which match the native trace.

Restoration initially revealed two provider API constraints: settings are not reverted by selecting an older code version, and editing version settings fails with error 10214 unless the latest version is deployed. The first-pass cleanup had already restored the Edge code when its redundant settings PATCH failed; Core was then explicitly restored and both settings verified. For the tracing pass, merely selecting the original versions likewise left tracing enabled. After consulting the provider API/version documentation, cleanup activated the actual latest diagnostic version, restored the original observability there, and then restored each original 100% code version. Final independent GETs confirmed **both original version selections, all original binding names/types, and complete original observability objects match**, with Traces disabled and original logs settings retained. No temporary diagnostic version remains routed.

Local scripts, minimized headers, request measurements and restoration snapshots are in `.local/ttfb-lifecycle-2026-11-17/`; they are not committed. The CLI historical telemetry API returned Forbidden, so historical native traces and lifecycle log association were read through the already-authenticated dashboard. No extra API scope or credential was created. The previous production RUM snapshot is unchanged by these test-environment measurements. The 70% podcast/Mole outcome is still unfulfilled and cannot be inferred from this diagnostic experiment.

After restoration, a fresh content-API smoke request returned **200**, with no `core_lifecycle`/`edge_lifecycle` response timing headers. TTFB was 3209ms on that single request; restoration is not a performance fix and that request has no lifecycle classification. Documentation-only follow-up checks passed: `pnpm exec openspec validate --all --strict` (135 passed, zero failures) and `git diff --check`. Local pre-push Bugs/Security/Compliance review found no Important findings: counts and Ray IDs match captured results, first-use association is not presented as a measured provider queue, temporary deployment/settings cleanup is explicitly recorded, and incomplete runtime/field tasks remain open. No shipped runtime file or package output changed in this continuation, so no new application test run, version decision or UI hands-on acceptance is required; the prior stylesheet verification retains its original scope.
