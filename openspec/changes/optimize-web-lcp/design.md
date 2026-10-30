# Design

## Context

See [proposal.md](proposal.md) for motivation. This is a feasibility and construction proposal, not a completed performance fix. Source was inspected on 2026-10-19; the planning branch starts at `origin/dev` (`4d051b70bea408b30a9e05fa8ee51270bd76502a`). The deployed SHA and its relationship to the full historical reporting window remain to be recorded during baseline capture.

The report uses the last 30 days, GMT+8, `Host = r.slax.com`, and bot exclusion. It is real-user monitoring, not a Cloudflare synthetic browser. Counts can be sampled estimates, and independent subpart percentiles must not be added together.

| Reviewed evidence | Interpretation and confidence |
| --- | --- |
| Overall LCP P75 approximately 3,340 ms; good 62%, needs improvement 21%, poor 17% | Historical outcome; not an estimate of how much this proposal will save. |
| `/b/ae51225c-840a-4b39-8fdf-2636dea962ea`: LCP 6,508 ms, image request delay 2,482 ms, load duration 1,996 ms; Count 400 | Prioritize early discovery; reported object host was `api-reader-beta.slax.com`. Historical host evidence is not proof of current environment misconfiguration. |
| `/b/b40a8cd1-d9c1-4de5-93b9-ffdec5ae1a98`: LCP 7,648 ms, document TTFB 3,721 ms, image delay 1,291 ms, render delay 2,291 ms; Count 110 | Multiple potential bottlenecks; an image-priority change alone cannot fix the document response. |
| `/b/aa181615-53fb-4f6b-a08f-d477537e230b`: tweet image LCP 7,504 ms, load duration 3,033 ms; Count 50 | Transfer/cache performance deserves separate evidence after discovery improvements. |
| `/login`: logo LCP 5,300 ms, request delay 3,390 ms, download 234 ms; Count 120 | Startup is a stronger lead than asset size. Current logo is 15,105 bytes, 176 x 176. |
| `/guide`: third image LCP P75 48,432 ms, request delay 11,887 ms, load duration 33,153 ms; Count 30 | Low-sample tail, not a measured maximum. Current three images are 6,895 / 7,642 / 6,980 bytes. Verify deployed assets and region/network before attributing the tail. |
| `/bookmarks`: promo image delay 3,657 ms, download 3 ms; Count 40 | Conditional rendering/startup is plausible. Do not weaken promotion/onboarding gates just to request an advertisement earlier. |

Source constraints:

- `apps/web/nuxt.config.ts` already enables buffered SSR for `/b/**`; `/login` and `/guide` use client rendering.
- `BookmarkArticle.vue` modifies all `<img>` strings to lazy loading, even in SSR output. Both `/b/**` and `/s/**` use this component.
- `strip-html.server.ts` removes serialized body duplication; `restore-html.client.ts` recovers the body from initial HTML. A new image transform must therefore be idempotent across recovered DOM serialization.
- `powersync.client.ts` awaits database startup and ownership/version guards. Consumers read a concrete `$powersync` during setup; Nuxt's injected property is not a slot that can simply be replaced after mounting.
- `image.processor.ts` clears `srcset` and adjusts styles. Its loading class is only an animated background, but its load/error and preview setup currently depend on a future load event. An eager image can already be complete before the processor installs those handlers, so the integration must make post-load handling idempotent and catch up completed images.
- Existing worker policy, session termination, KOC/onboarding readiness, PDF/media, and WeChat sizing changes are active. No parallel delta for those capabilities is introduced here.

## Goals / Non-Goals

**Goals:** Remove avoidable image request delay and anonymous public-page database waits through two bounded changes; keep one production rollback path per change; measure mechanisms before claiming field improvement.

**Non-goals:** Broader asynchronous local-first architecture; new SSR routes; media proxy or API contract changes; generic image transcoding; video/poster processing; rewriting saved HTML or its signed URLs; changing article dimensions, content selection anchors, promotion gates, or visual design.

## Decisions

### 1. Use one reviewed implementation change with independent milestones

Use branch `perf/optimize-web-lcp`, change ID `optimize-web-lcp`, and one eventual PR to `dev`. Commit and verify the article policy separately from the startup bypass. Two build-time app-config booleans, `lcp.articleImagePriority` and `lcp.anonymousPublicStartup`, can be enabled separately. Their defaults are build-time constants (`nuxt.config.ts` → `vite.define`): disabled for `production` and `beta`, enabled for `preview` and `development`, so the measurement gates below can run on the test environment before production enablement. No environment secret, remote flag service, or persisted user flag is introduced. Deployment is a later authorized operation.

This avoids packaging speculative backend work into the same release. Separate milestones remain independently reviewable and disableable, even if the final approved PR contains both implementations.

### 2. Use one HTML5 decision tree and preserve the source

Create `apps/web/app/utils/articleImageLoading.ts` with the synchronous interface:

```ts
export interface ArticleImageLoadingOptions {
  enabled: boolean
  excludedPresentation: boolean
}
export function applyArticleImageLoading(html: string, options: ArticleImageLoadingOptions): string
```

Call it from the `articleHTML` computed value in `BookmarkArticle.vue`. It covers SSR, `/s/**`, SPA navigation, and refreshed bodies. PDF bypasses the HTML body; PhotoSwipe uses the established fallback. Both server and client use `parse5@8.0.1` with an explicit HTML `div` fragment context matching `.html-text`, scripting enabled, and source locations. The browser's HTML5 tree repair, including table foster parenting, determines traversal order; source opening-tag order does not. Use the same evaluator and parser options on both platforms. Recompute from the restored body during hydration and prove equivalence; never trust an incoming `fetchpriority=high` as evidence of an application-selected image.

The bounded candidate policy is:

1. Count decoded non-whitespace Unicode code points in HTML5 tree order, excluding `script`, `style`, `template`, `noscript`, and explicitly hidden subtrees. The body text budget excludes the separate reader title/header; viewport checks remain required.
2. Consider HTML-namespace `img` nodes while fewer than 600 such characters have appeared. Exactly 600 is late. This is a heuristic, not a server-side viewport measurement.
3. Exclude empty/data/blob sources and explicitly hidden nodes/ancestors (`hidden`, inline `display:none` or `visibility:hidden`). `aria-hidden=true` alone does not mean visually hidden and does not exclude a substantive image or its text from the budget.
4. Exclude an explicit positive display width or height at most 96 px, including pixel `max-width`/`max-height`. Prefer authored pixel display constraints over intrinsic HTML dimensions; unknown or relative dimensions alone do not prove smallness. Resolve duplicate CSS declarations and `!important` consistently on server/client; no broad CSS/layout evaluator is introduced. Ambiguous sizing is unknown, never a guessed pixel value.
5. For classification only, remove the existing leading `oc-` class-isolation prefix. Exclude image class tokens `avatar`, `icon`, `emoji`, `logo`, `profile-image`, and `zhihu-qa-avatar`; also exclude images within `tweet-header`, `quote-header`, or `zhihu-qa-user` class containers. Do not rewrite classes, reserve new global tokens, or treat the entire tweet/social-post as a header. Invalid ARIA roles such as `avatar` are not a classification API.
6. After filtering identifiable hidden/small/icon/avatar images, treat the first remaining substantive image with nonempty `srcset` or inside `picture` with a nonempty source `srcset` as a **stop boundary**: return no promoted image for that body, rather than skipping it and promoting a later potentially below-fold image. Unknown dimensions count as substantive for this stop rule. Responsive icons already excluded by earlier rules do not stop the scan. Runtime `srcset` removal remains unchanged; advancing a responsive request before that removal could fetch a different resource twice. Preserve those attributes and retain lazy behavior; use a separate responsive-media change if this image is the measured LCP.
7. Select the first remaining candidate, including one with unknown dimensions. Assign it exactly one `loading="eager"` and `fetchpriority="high"`; give other supported ordinary images exactly one `loading="lazy"` and `fetchpriority="auto"`.
8. Preserve every non-policy byte: signed source query, `srcset`, `sizes`, alt, dimensions, inline styles, custom tags, anchors, and content order. Patch only opening-tag attribute spans from right to left, using parse5 source locations and a quote-aware scanner to remove all duplicate policy attributes. Never serialize the whole fragment. Implicit nodes such as `tbody` need no source edit; they are not a failure. Missing/ambiguous source spans on an image that must be edited fail the whole transform back to the established rendering path. Disabled/excluded inputs use that path directly.

HTML5 parsing is not a universal hydration proof. Integration fixtures must compare the API body, actual SSR processors' output, the browser-parsed `.html-text.innerHTML`, and raw SPA refresh. Include foster-parented images, implicit `tbody`, malformed paragraphs, SVG/MathML boundaries, custom media, duplicate attributes, and parser errors. If equivalence fails, hold image-policy enablement and fix the bounded case or revise the design; do not silently choose a different image after hydration. Existing strip/restore plugins remain integration constraints, not assumed changes.

**Parser feasibility and budget:** An in-memory browser ES2022 ESM/minified esbuild 0.28.2 probe exporting only `parse5.parseFragment` produced 151,509 raw bytes, 41,998 gzip bytes (level 9), and 36,432 Brotli bytes on 2026-10-19. This is a standalone dependency estimate, not a Nuxt production delta or LCP measurement. It disproves assuming the old 20 KiB budget will fit. The revised proposal explicitly budgets **at most 50 KiB incremental gzip JavaScript** across the article route's initial dependency closure, with Brotli reported too. Measure against the pre-change build, with identical build/compression settings; shared chunks count once. Check login/guide and authenticated controls as well. Keep the existing below-10-ms median transform gate on the 100 KB/100-image fixture. Actual slow-network/slow-CPU LCP and interaction gates take precedence over fitting the byte ceiling. Do this build feasibility check before full component integration. If it fails, stop the image milestone and revise; public startup may proceed independently.

**Alternatives:** `htmlparser2` does not reproduce browser tree repair. Native client parsing plus server parsing would need a reliable DOM-to-source identity mapping; image ordinals are invalid when repair reorders nodes. The first release therefore accepts the explicitly larger shared parser budget for a single decision algorithm. No post-mount selection, raw class mutation, metadata authority from saved HTML, or blanket eager loading is introduced. The image switch restores loading attributes, not the pre-change bundle graph; reverting the implementation deployment is the rollback for parser-download regressions.

### 3. Complete image setup regardless of event timing

Update `image.processor.ts` and its existing tests before enabling eager loading. Extract a per-image completion routine used by both future load events and already-complete success (`complete && naturalWidth > 0`). Install load/error handling and initial loading state before catch-up; catch-up must not be undone by adding the loading class afterward. Preserve the current source normalization and evaluate the settled current resource, including the existing `srcset` mutation, before applying a completed-state shortcut.

Make completion/error work repeat-safe for a resource and for repeated processor runs. Preserve current preview eligibility: tracking images remain hidden; the existing non-WeChat medium-image early return does not suddenly gain preview. A preview handler can be registered independently only if it gates on successful completion and existing eligibility; sharing the whole eligible completion routine is also valid. Preserve WeChat authored styles, PhotoSwipe behavior, and cleanup ownership. Handle already-failed images, failures after registration, and later successful reloads without duplicate callbacks or a permanently stuck loading state. This lifecycle correction remains active when image prioritization is disabled; a regression in it requires reverting its implementation commit/deployment, not just toggling priority.

### 4. Bypass database initialization while preserving static startup

Create `apps/web/app/local-first/public-startup-policy.ts`:

```ts
export function isFastPublicPath(pathname: string): boolean
export function shouldBypassPublicDatabase(input: {
  enabled: boolean; pathname: string; topLevel: boolean
  tokenState: 'absent' | 'present' | 'error'
}): boolean
export function needsPublicDocumentExit(bypassed: boolean, destinationPath: string): boolean
```

The allowlist is exactly `/login` and `/guide`, with optional trailing slash. Use the initial document pathname, not a pending router destination. Bypass only a top-level document with no token. Capture a token read as `absent`, `present`, or `error`; only `absent` can bypass. A caught exception becomes `error`, never `absent` or a falsy token. `present` and `error` return false from the predicate and follow the established normal/fallback handling. Authenticated guide entry, `/auth`, `/b/**`, `/s/**`, root Inbox, `/bookmarks`, and `/x/ext-bridge` retain normal startup.

Keep `powersync.client.ts` and its static SDK imports. After capturing config/state and before constructing the connector or database, evaluate the bypass predicate. On bypass, return the existing null/no-op providers plus `powersyncPublicBypass: true`, leave local ownership unset, and perform no constructor/init/migrate/connect/clear. Otherwise execute the existing initializer in its current Nuxt plugin context and add `powersyncPublicBypass: false` to success and fallback providers. Do not extract an async runtime module or add a dynamic-import boundary in this release. SDK download/parse cost remains; only the database wait is removed. This smaller change avoids a new serial network request or composable-context boundary for normal users.

Add client-only `powersync-public-exit.global.ts` after `auth.global.ts`. A bypassed document leaving the allowlist requests `navigateTo(to.fullPath, { external: true })` through the shared navigation guard and returns its result before destination components mount. Use only the router-resolved internal destination; retain existing auth redirects. Public-to-public and same-page hash/query navigation stays SPA unless the restore rule below requires re-entering normal startup. OAuth already makes a document navigation. New documents recompute startup from their initial path/token. The bypass marker is immutable for the current document and is never written to browser storage; BFCache can retain it in that document's memory.

Add `powersync-public-restore.client.ts`, with explicit Nuxt `dependsOn` ordering after a named `slax:powersync` plugin. Give the existing plugin that name without changing its static imports or setup context; do not rely on filename sorting. The companion owns an app-scoped navigation guard exposed as `powersyncPublicNavigate` to the exit middleware and captures its router/Nuxt context during setup. Install one removable `pageshow` listener for bypassed documents. Only `event.persisted` activates the restore check: read token state again, leaving `absent` on the public page with local queries unavailable; for `present` or `error`, request one full navigation to the router-resolved current fullPath so the new document runs normal startup or its fallback. Never reinitialize the database, flip the bypass marker, or enable local queries in the restored document. Fresh non-persisted events and normal documents are inert. This does not add general cross-tab authentication synchronization.

Share the navigation latch between restored-page redirects and the exit middleware; duplicate requests must also abort destination SPA mounting. Reset it on `pagehide` for the next restored activation and on failed/cancelled navigation, so a BFCache snapshot never traps a previously used latch. Preserve listeners while frozen; remove both lifecycle listeners on app teardown/HMR, without `unload`/`beforeunload` handlers that can defeat BFCache. Invoke Nuxt navigation from the captured app context, not a composable called outside setup. Test leave/back/leave cycles, same-path restore with absent/present/error token states, simultaneous restore/exit, and cleanup. Browser-back, auth redirects, campaign parameters, and guide exits need real-browser checks. Normal sessions' SPA logout/login keep their current cleanup. A bypassed document neither opens prior account rows nor erases pending writes.

### 5. Verify the delay mechanism before choosing further work

No production-performance claim is established by this planning pass. Baseline and candidate evidence must record:

- Deployed build identity, test build identity, exact UTC/GMT+8 window, host/bot filters, and browser version.
- Each normal article, WeChat article, tweet image article, `/login`, `/guide`; authenticated root Inbox/`/bookmarks`, `/b/**`, `/s/**`, authenticated guide, the extension bridge, and a text-heavy article as controls. Historical report URLs above are reference samples, not committed fixtures.
- Anonymous cold navigation and authenticated navigation where applicable; mobile/desktop; initial document navigation versus SPA entry; cold and warm browser cache; Service Worker state. Do not label a cold browser cache as a cold edge cache.
- HTML response/build identity, selected LCP element, request start, initiator/priority, download duration, render delay, document TTFB, CLS, interaction traces, plugin completion, app mount, and first local-query timing where applicable. For public routes, establish whether database construction/init occurred before mounting.
- At least five repeated comparable runs per key condition, interleaving baseline/candidate. Report median and range, not a statistically stable P75 from five runs. Use 20 or more repeats if a small difference needs a stronger comparison.

Use DevTools Performance/network capture or an equivalent controlled browser trace. It is not currently configured in this session, so traces are an implementation evidence task, not something this proposal claims to have completed. The existing database recovery logs help locate startup boundaries. A local-only diagnostic plugin may add User Timing marks during testing; do not send raw article URLs, content, account IDs, or tokens to a new telemetry service.

### 6. Acceptance and stop conditions

| Area | Required gate |
| --- | --- |
| Image correctness | At most one high-priority candidate; correct exclusion/text-budget handling; exactly one policy attribute; identical choice for the same raw input across server and new client navigation; hydration preserves the SSR choice after browser HTML repair; preserved signed URL, dimensions, body, anchors, and custom media fallback. |
| Public startup | With initializer deliberately unresolved, anonymous login/guide still mount and show controls; database constructor/init/connect/clear invocation count is zero. |
| Navigation/data | One document transition per required exit/restore; no reload loop or stale latch after leave/back/leave; query/hash/redirect/campaign intact; ownership/recovery/bridge/onboarding tests pass; restored bypass documents never enable local reads. |
| Measured mechanism | Image-policy candidate requests start earlier in repeated comparable traces; public-page traces remove database-init dependency. If neither mechanism improves, do not enable the corresponding switch. |
| Performance regression | Investigate/hold a candidate with a repeatable median LCP regression greater than both 100 ms and 5% on controls, new layout shifts, or new long tasks around interaction. These are review tolerances, not universal CWV thresholds. |
| Parser overhead | Median transform below 10 ms on the fixed 100 KB/100-image fixture; at most 50 KiB added gzip JavaScript across the initial article-route dependency closure versus pre-change, including shared chunks. Record Brotli too. No exemption from slow-network/CPU, hydration, or control-route regression checks. |
| Normal startup | Compare pre-change, off/off, on/off, off/on, and on/on on authenticated Inbox, article, share, guide, and bridge controls. No new serial runtime chunk. Hold repeatable median app-mount or first-local-query regressions greater than both 100 ms and 5%; separately apply the LCP/interaction gate. |
| Cache/rollback | Run the staged rollback drill below on warmed owner/visitor share HTML before production enablement. Record effective build/attributes and x-bcache, confirm purge behavior or expiry convergence, and exclude mixed-build observations. Active tabs are not remotely toggled. |
| Visual/behavioral | Article selection and highlights, image preview, WeChat icons and intentional frames, theme states, login providers, invitation banner, guide actions, and keyboard use remain functional. |
| Field outcome | Compare matched 7-day pre/post route/device/region/browser cohorts after rollout; retain 30-day trends separately. Target LCP P75 at or below 2.5 seconds for adequately sampled target cohorts, but do not promise that this change alone reaches it. Report small or shifted samples as inconclusive. |

The report's 48,432 ms guide row is a low-count P75, not a maximum and not a baseline that this change is guaranteed to eliminate. Cross-origin resource subparts can also be incomplete without appropriate timing exposure; waterfall evidence must accompany interpretation.

## Review disposition (2026-10-19)

The revision incorporates the first review and an independent subagent pass over Bugs, Security, and Compliance. These are planning conclusions, not implementation/test completion.

| Concern | Incorporated decision | Remaining implementation proof |
| --- | --- | --- |
| Image loaded before handler registration | Shared repeat-safe completion/error path, existing eligibility preserved | Real cached/failed/reloaded image scenarios and current WeChat suite |
| SSR-prefixed classes select an avatar | Normalize known class-isolation prefix only for classification; explicit social headers | Actual server-processor to browser-restore integration |
| Browser repair changes image order | Shared div-context HTML5 parser; tree-order choice and source-location patches | Browser hydration and malformed-fragment cases |
| Normal users pay a serial runtime download | Keep static PowerSync imports and the existing plugin context | Pre-change and all-four-switch control traces |
| Rollback is masked by old cached HTML | Pre-production warmed owner/visitor drill; verify expiry and hashed assets | Environment-specific purge/convergence evidence |
| Skipping a responsive hero promotes the next below-fold image | First otherwise substantive responsive image stops selection; excluded icons do not | Responsive-hero-followed-by-plain-image fixture |
| Token-read exception mistaken for anonymous state | Explicit absent/present/error input; only absent bypasses | Real plugin exception case and no unsafe anonymous classification |
| BFCache restores a stale bypass document | A removable client-only `pageshow` listener re-evaluates token/cookie state; `present`/`error` forces one guarded full navigation while `absent` keeps local queries unavailable | Real-browser back/forward restore with account transition, listener cleanup, and no destination local-query mount before normal startup |

The independent pass initially identified a BFCache lifecycle gap; this revision adds an explicit removable `pageshow` listener and narrows the assertion to destination startup/local-query access, which is meaningful for a restored already-mounted document. After that revision no remaining Important issue is known. The token-state interface refinement makes failure behavior explicit, and no new confirmed Security issue was found. Bundle/slow-device results, browser-back/BFCache behavior, source-span correctness, and deployment rollback remain required evidence gates; none is represented as already verified by this review.

## Risks / Trade-offs

- [A server heuristic can select a below-fold image] → Cap selection to one and the early text budget; validate at 390, 768, and 1440 CSS-pixel widths; retain a disable switch.
- [An eager or cached image completes before the processor installs handlers] → Make image post-load work idempotent, bind preview independently, catch up `complete && naturalWidth > 0`, and test load-before/after-processor plus error paths.
- [SSR class isolation or browser HTML repair changes the candidate] → Normalize `oc-` prefixes and real social presentation tokens; use an HTML5 parser with source locations; compare raw, SSR-processed, browser-restored, and SPA fixtures.
- [HTML mutation can corrupt signed URLs or text anchors] → Patch only policy attributes using source spans; fixture tests and hydration/browser checks; never migrate stored bodies.
- [A parser adds startup work] → Measure actual emitted bytes and transform time; leave the feature disabled if the stated budget fails.
- [Skipping the plugin could prevent later local-first use] → Do not change the database injection while mounted; require the document transition before leaving bypassed surfaces.
- [Changing startup ordering affects authenticated users] → Retain static imports and the existing initializer context; add only the early bypass and measure normal-session controls against pre-change.
- [Public pages still download SDK code] → Report the bounded database-wait benefit honestly; only consider SDK splitting in a separate evidence-backed change.
- [An earlier image exposes existing sizing/CLS issues] → Re-run the current WeChat sizing suite and visual checks; do not overwrite author dimensions or expand this task into a sizing redesign.
- [SSR/cache response delay remains dominant] → Image policy cannot accelerate bytes that have not arrived; use the follow-up gate below.
- [Other work modifies the same runtime/component] → Rebase on current `origin/dev` before implementation, retain current worker/ownership rules, and sequence overlapping edits. Do not author another delta for capabilities already owned by active changes.

## Migration Plan

### Delivery estimate and order

These are engineering effort ranges for one engineer familiar with the repository, not guaranteed delivery times. They exclude approval queues and production observation.

| Milestone | Deliverable | Effort | Decision |
| --- | --- | --- | --- |
| A: Baseline | Build-aligned traces and sanitized fixtures; verify report assumptions | 0.5–1 day | If the deployed behavior differs, update evidence before enabling changes. |
| B: Article policy | Parser feasibility, shared HTML5 transform, lifecycle catch-up, browser integration, disabled switch | 2–3 days | Enable in test builds only after parser/correctness gates pass. |
| C: Anonymous startup | Early bypass in the existing plugin, exit middleware, navigation/ownership tests | 1–2 days | Prefer this bounded path over a broad reactive-runtime rewrite. |
| D: Verification/release preparation | Production-like comparisons, browser checks, staged rollback drill, review, release record | 1–2 days | Make each switch's decision separately. |
| E: Field assessment | Matched 7-day cohorts, then 30-day trend | 7 calendar days of observation | Observation is not additional continuous engineering effort. |

Initial implementation estimate: **4.5–8 engineering days**, plus production observation. If a gate fails, keep the relevant switch disabled and present evidence and a revised estimate; do not silently broaden scope.

### Deployment and rollback

1. Human review, then implementation on the task branch and PR to `dev` with `OpenSpec: optimize-web-lcp`. No implementation or deployment is authorized by editing this proposal.
2. Before pushing behavior changes, complete local `REVIEW.md` passes, resolve Important findings, run strict OpenSpec validation and relevant checks.
3. Compare the pre-change build and all four switch combinations (`off/off`, `on/off`, `off/on`, `on/on`). Flags restore behavior but do not necessarily remove parser bytes or the lifecycle correction. Record independent enablement decisions.
4. **Before production enablement**, warm synthetic owner and visitor `/b/**` responses in the existing test/beta environment, deploy a flag-disabled candidate or authorized known-good rollback, run the existing hostname purge, and fetch those same routes again. Record effective build/asset identity, loading attributes, `x-bcache` and `x-bcache-type`; also inspect a fresh uncached route. Use isolated test accounts and synthetic content. Do not bypass owner/visitor guards or expose cache keys through new endpoints.
5. Existing share keys use `https://__bcache.slax__/...`, while the release procedure purges the environment's public hostname. The source establishes a mismatch, not that purge definitely fails in production. Verify eviction rather than assume it. The configured cache lifetime is 600 seconds **from the final old-build cache write**, not exactly 600 seconds from starting a deploy. Allow for in-flight old requests; record the final old-build write/drain boundary and verify convergence after expiry if targeted eviction is not demonstrated. Query-string cache busting does not change these share keys. Keep previous hashed assets reachable during the overlap and test an old HTML response against the rollback asset deployment.
6. If the drill cannot show fresh and warmed routes converging safely, or old HTML loses required assets, keep the affected feature disabled and resolve cache invalidation/versioning in a separate reviewed change before rollout. Do not claim immediate rollback and do not purge unrelated image storage. Browser caches, service workers, and already-open tabs have separate lifetimes; flags take effect on a newly loaded matching build.
7. Promote through the established `dev → beta → main` flow with merge commits and human-controlled promotion merging. Production deployment remains a later authorized operation. After release, repeat the effective-build/cache checks before starting the field comparison window.
8. For priority-only issues, disable that build-time flag and release normally; for parser-byte or image-lifecycle regressions revert the implementation deployment/commit. Public startup can be disabled independently. A known-good Pages deployment is an operator rollback option under the existing runbook, followed by the same convergence checks. No database or saved-body migration is involved. Archive after implementation merge and retain the outcome record even when inconclusive.

### Evidence-gated follow-up work

The following work needs separate change IDs/PRs if justified; it is not hidden implementation scope in this proposal. API-related follow-up should follow the `postman:api-engineer` contract-first guidance, using the existing endpoint and tests rather than introducing a new API merely for performance.

| Follow-up | Trigger and concrete first action | Boundaries | Estimate |
| --- | --- | --- | --- |
| Document TTFB | TTFB remains a major delay after B. Compare `x-bcache=hit/store`, metadata/backend and R2 timing, article processing and rendering. `loadContent.ts` already fetches metadata and body in parallel; do not propose that as a new optimization. Existing detailed Server-Timing is environment-gated; use beta tracing or propose bounded production diagnostics. | Preserve owner/visitor cache isolation, response-header decisions, and buffered `/b/**` rendering. | 0.5–1 day diagnosis; fix estimate after bottleneck attribution. |
| Image cache tier | Slow image requests cluster by cache condition. Instrument a bounded cache-tier diagnostic and compare `Cache API → R2 → origin`. Current R2-hit branch returns without an explicit Cache API refill. | Preserve `/static/image` signature/referrer/MIME/size/range behavior. Verify R2-hit cache insertion and second-request hit through existing handler tests before any release. Do not remove full-buffer safety checks as an incidental optimization. | 0.5–1 day diagnosis; 1–2 days for a proven bounded refill change. |
| Historical beta image host | Matching slow visits still use beta-host objects. Inspect authorized sample HTML and generated image URL provenance. | No blind hostname replacement; verify environment-specific signatures and storage. No secret reads. | 0.5 day investigation; migration separately estimated. |
| Responsive image variants | Trace shows large actual encoded bytes after start-time/cache fixes, especially tweet/WeChat originals. Measure displayed width/DPR and repeat views. | Design signed variants, cache keys, format negotiation, cost bounds, animation handling, and original-image preview together. Do not simply preserve third-party `srcset` that bypasses proxy policy. | 3–5 days after design/provider choice; not part of the 4.5–8 day first release. |
| Video/guide tail | Video or guide remains a material cohort issue with sufficient evidence. Verify video poster versus first frame, deployed guide asset hash/size, browser, country, and request timing. | No assumption that the 48-second row is caused by file size or the 8/15-second database recovery budgets. | 0.5–1 day diagnosis. |

## Open Questions

- The exact deployed revisions represented in the last 30 days and whether the reported beta image URLs remain in current sample bodies.
- The current device/region composition and unsampled support for each cohort. Dashboard Count alone is not enough to declare a reliable experiment.
- Whether production-like traces reproduce request-start delay on anonymous login/guide and the representative article pages. These determine enablement and follow-up priority, not permission to weaken correctness gates.

## References

- [Cloudflare report](https://dash.cloudflare.com/f74694cd77e247e071af286f40d20116/web-analytics/overview?siteTag~in=2dc72e6d3741449093f7df924207957c&excludeBots=Yes&host=r.slax.com&time-window=43200)
- [Cloudflare Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/)
- [Cloudflare sampling FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [Design contract](../../../DESIGN.md)
- [Implementation plan](../../../docs/superpowers/plans/2026-10-19-optimize-web-lcp.md)
