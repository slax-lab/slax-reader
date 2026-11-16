# Design

## Context

See `proposal.md` for motivation and scope. The source baseline is `origin/dev` merge `2203281e` (PR #605), fetched on November 16, 2026. Production initially lacked that merge. The change requester subsequently approved the initial player-layout slice and later reported #605 production deployment, resuming its verification. Fresh deployment/resource/interaction evidence and remaining controlled-profile, attribution and field gaps are recorded in `validation.md`; the runtime implementation scope remains unchanged.

The frozen November 13–16 investigation covers 165 LCP events across seven URLs. The original podcast has 19/36 valid comparable hard navigations with TTFB above 2.5 seconds; the video podcast has 24/39. Those are unchanged-TTFB counterfactual limits on those observations, not projections for future traffic. A clean production desktop trace of the video podcast had text candidates at 1.822 and 3.656 seconds. It also loaded two YouTube iframe documents; the second request started after final LCP and is not a measured cause of that candidate gap.

The geometry-to-LCP mechanism remains a hypothesis. Moving an already-painted paragraph does not itself prove a new LCP event. The baseline must determine whether enhancement brings the later candidate into the viewport for its first paint, or whether #605 node retention already removes the later candidate. Do not retain a runtime edit solely from a source mismatch: reproduce the geometry change after #605 and measure its LCP/CLS effect.

Current source facts:

- Saved edited YouTube HTML contains a full-width native iframe. `YoutubeProcessor` replaces the player at its existing lifecycle position and sets the edited player's host to `display:block`, `max-width:440px`, `margin:0 auto 24px`.
- `YoutubePlayer.ce.vue` owns a Shadow DOM wrapper with its own vertical margins and 16:9 frame. The initial iframe is exposed to the generic article `iframe[src]` minimum-height rule; the enhanced iframe inside Shadow DOM is not. Width alone is therefore not a complete box match.
- Cached anonymous HTML still validates current complete metadata through Web -> Edge `ContentEntry` -> Core -> domain -> existing repositories. `resolveBookmarkReadAccess` fetches bookmark, then owner, then share; `UserRepo.getInfoByUserId` throws for missing/deleted owners.
- `DatabaseRegistry` provides one cached `PRISIMA_HYPERDRIVE_CLIENT` per request container, using `PrismaPg(new Pool({ max: 1, ... }))`. Both repositories resolve that same client, and the installed adapter delegates to its `query` operation. A Promise-only overlap does not add a database connection or remove the single-connection query queue.
- `getPdfDescriptor` returns immediately for non-PDF content. An anonymous non-fork metadata path can also return without repository I/O. `loadTrace` already overlaps its three reads. Parallelizing those names indiscriminately is not justified.
- PR #605 restores initial client content from the browser DOM and adopts unchanged article nodes. Font display is already `swap`; anonymous public database startup already has a bypass. Those mechanisms are not new work here.

## Goals / Non-Goals

**Goals:** stabilize initial edited-YouTube player geometry without altering its final appearance, and attribute the remaining first-byte delay on normal successful requests. Preserve existing naming, files, feature ownership, layer edges, call chains and response contracts.

**Non-Goals:** player lazy initialization or iframe adoption, API query scheduling/pool/placement changes, new caches or endpoints, metadata projection redesign, changed authorization/revisions/TTL, generic parallel-execution helpers, snapshot rewriting, image resizing, broad stylesheet splitting, paragraph virtualization, or Mobile/Extension changes.

## Decisions

### 1. Separate deployment, mechanism and field evidence

The test environment can establish code/mechanism behavior and expose #605 timing stages. It cannot establish the production 70% outcome or provide a valid before/after comparison using missing/different content. See `validation.md` for current evidence and gaps. Keep the original #605 outcome tasks open.

Four production sample UUIDs returned 404 on `r.slax.dev`. On November 16, 2026, the change requester confirmed that no public test samples were available and initially deferred verification. They later reported production deployment and resumed the same-content checks there. A subsequent search of the test site's public collection sitemap found different real test articles, allowing successful-request stage measurement without creating data, copying production snapshots, recapturing content or weakening access. These articles establish the normal metadata route, not production-canary parity. Production intentionally omits granular timing headers. Remaining same-content, controlled-profile and field gaps stay explicit in `tasks.md` and `validation.md`.

### 2. Match the existing enhanced box in the Web article stylesheet

Start in `apps/web/styles/article/_article.scss`, which already owns article iframe styling. Match the existing processor predicate rather than assuming the marker contains the player: `useArticleSelection` passes `.article-detail` as the processing container, and `YoutubeProcessor` searches anywhere inside it for `data-slax-derived="youtube-article"`. The saved body's player and marked article are siblings. Within the existing article mixin, scope the fallback rule to that container when it contains the marker, and then to its native `youtube-player` and iframe. Use the existing `:has()` styling convention; add no compatibility fallback. Existing saved and newly generated bodies already have these markers; do not change the capture builder or stored HTML.

Explicitly make the fallback host and iframe block-level. A width cap on an inline unknown host does not constrain it, and an inline iframe can retain a line-box descender gap. Confirm the generated selector has the owning `.article-detail` prefix and matches the processor's effective condition. The separate generated-article slot is outside `.article-detail` in `BookmarkArticle.vue`, so it does not activate this condition for the original annotated transcript.

Use the current enhanced player as the reference: a responsive host capped at 440px, a 16:9 inner frame, and its measured effective top/bottom spacing. Account for the CE's inner margins and margin collapsing rather than summing its declarations. Override the generic minimum height only on this exact fallback; verify the winning emitted CSS and computed minimum height, not only the SCSS directive. Compare host height, effective gaps and introduction-top delta before/after enhancement with otherwise unchanged layout. Retain the inline frame width/aspect ratio where already correct; add no unnecessary `!important`, radius, background or placeholder, and do not move the player to another layer.

Keep `YoutubeProcessor`, its ordering, its node replacement, `YoutubePlayer.ce.vue`, iframe API initialization and all seek listeners unchanged unless the real box comparison proves that matching the fallback cannot be achieved solely in this owning stylesheet. Such a result requires updating this design before expanding the runtime diff. No shared geometry framework, configuration flag, new token or helper is needed for a single local fallback rule.

The DOM remains complete. Do not hide or shrink text to select an earlier LCP candidate. Raw YouTube transcripts, separate generated-article views, podcasts, ordinary articles, other iframes, sidebars and the shell retain their existing presentation. The intended visible change is confined to the saved edited player's initial state matching its existing final state.

Alternative rejected: changing `HtmlBuilder.youtubePlayer` alone. It would miss old saved bodies and expand capture/backend scope. Alternative deferred: adopting the first iframe or deferring the API. That changes lifecycle/readiness and first-seek behavior, while the measured second download occurred after LCP.

### 3. Measure the complete metadata route without changing it

Collect successful anonymous document requests with and without an HTML-cache hit using #605's fixed non-production timings. Include `front_backend-fetch` or `front_cache-validation`, `edge_core-fetch`, `core_total`, `core_orchestrator`, access substeps, trace and collection. Record request connection/TLS separately. Nested stage durations overlap and must not be summed.

The earlier 404 responses exposed substantial separation between frontend/backend, edge/core and core duration. Fresh successful requests now reproduce that separation: one 2790ms content-API TTFB had 2047ms frontend backend-fetch, 1412ms edge core-fetch and 613ms Core total. Temporally matched Core/Edge tails showed 728/1411ms wall time, 182/0ms CPU and a 630ms difference between invocation timestamps. Tail query values are redacted, so these are explicit time-window associations, not request-ID traces. The data localizes major wait outside the measured Core handler but does not distinguish script initialization, platform scheduling or other dispatch effects. A large `front_backend-fetch` must not be labeled slow SQL, and repository awaits must not be labeled database execution alone.

Use five repeated normal hit/miss requests to attribute the mechanism and record the workload, connection reuse, median/P75 and complete request duration. A future small timing decision would require twenty interleaved baseline/candidate pairs. If a normal sample is unavailable, leave attribution pending; player stabilization can proceed independently. No API scheduling change, production timing header or new beacon is selected here.

### 4. Remove the Promise-only query-overlap candidate

The previous investigation nominated owner/share overlap conditionally. Further inspection of the actual connection ownership invalidates the assumed independent I/O capacity: the request container caches one Hyperdrive Prisma client with a `max: 1` PostgreSQL pool. Both operations would still queue for that connection. The node-postgres [pooling documentation](https://node-postgres.com/features/pooling) describes the single-client FIFO query constraint. Minor JavaScript scheduling differences are not evidence of removing a database round trip.

A plain `Promise.all` could also change which rejection wins: the owner lookup currently throws for missing/deleted owners, and share lookup only begins afterward. Settlement machinery would add complexity and an unnecessary denied-path share read without an established query-wait saving. The existing helper also serves mark, share and collection flows, expanding the verification surface of a change motivated by one metadata endpoint.

Retain the current serial helper and all callers. Do not increase the pool size, create another client, add a settlement wrapper, or move I/O to the support helper to rescue this candidate. Those changes have a different resource and failure cost and would need a separately justified proposal after successful-request measurements identify the bottleneck.

No API runtime code, metadata fields or insertion order changes. Fresh revocation, moderation, deleted content, media checks, credential isolation and full presentation revision validation remain intact.

## Risks / Trade-offs

- A width-only fix can retain a height/margin shift -> compare complete boxes and first-paragraph position with full generated application CSS, at 390/768/1440px, through hydration and media processing.
- Broad iframe CSS could affect other content -> scope to the exact saved edited-YouTube structure; include raw transcript, podcast and ordinary iframe controls in browser verification.
- First-byte time may be dominated by service transport rather than owner/share queries -> use successful whole-route timing; keep API runtime and placement unchanged in this proposal.
- Desktop evidence does not prove mobile/Safari parity -> use the existing controlled mobile profile and record any real-device gaps accurately.
- #605 production delivery does not establish the field target -> use its verified serving-build/convergence boundary and sufficient family counts; no predicted Good-rate increase is claimed.

## Migration Plan

No data migration, dependency update, config change, snapshot repair or new API is required. After proposal approval, implement only the stylesheet slice and its focused verification on the task branch, targeting `dev`. First-byte attribution is recorded as evidence, not an API implementation.

Before a behavior PR, record automated and running-environment evidence, perform Bugs/Security/Compliance review including the new backend scope rules, and obtain the human hands-on acceptance required for the initial player presentation. This plan requests no acceptance or screenshot during proposal preparation. Web/API-only scope requires no CLI, Extension or Mobile version change; reassess if the implementation scope changes.

After an authorized test deployment and 600-second cache convergence, use the existing 390x844 DPR2, 1.6Mbps down/750Kbps up/150ms configured latency/CPU4x profile plus desktop control. Preserve highlights, image preview, raw transcript/edited chapter seeking, podcast play/jump/pre-metadata intent/refresh-resume, and all current media behavior. The inherited controlled LCP P75 <=2300ms gate and diagnostic TTFB P75 <=1200ms target remain separate from field acceptance.

Production verification waits for human promotion. After production convergence, measure the existing seven-day podcast/Mole contract: at least 200 LCP events per family, at least 100 per primary canary, and both raw and matched-mix Good >=70%. Do not average URL percentages or add P75 components. Keep unavailable navigation timing and insufficient counts explicit.

Rollback is reverting this task's bounded runtime diff and redeploying the previous approved build through the existing release process. Stored content and access policy require no rollback migration.
