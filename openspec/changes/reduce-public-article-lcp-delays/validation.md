# Baseline and implementation evidence

## Status

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
