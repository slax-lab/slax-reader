# Reader bridge preprocessing audit — 2026-11-03

> Follow-up: the owner subsequently approved the common-processing subset. During implementation the sibling checkout advanced to `29dceb3437deae03cd8f5eb7656fb183446ab607`, which already contains the programmatic-selection fix described below. That implementation was retained and covered by integration tests. The bridge now includes common image/span/details/link/table/iframe processing, and its production build has been synchronized into Mobile. Media processors remain unchanged. The sections below preserve the earlier audit snapshot; current implementation and verification are recorded under section 3F in `openspec/changes/archive/2026-11-10-mobile-library-reader-polish/validation.md`.

## Scope and evidence

This is a read-only comparison of the main checkout at `/Users/yjc/Documents/Company/slax-reader-v2` (HEAD `656b9bcb64ce1d4538db3b560fc14a277ed389a5`, including the current Mobile presentation changes) and sibling `/Users/yjc/Documents/Company/slax-reader-web-bridge` (HEAD `95f297faa8885ca28cd828f46d198e6d5046af66`, dated 2026-07-24). No bridge source or bundled bridge was changed for this audit. The sibling's existing untracked `CLAUDE.md` was preserved.

The comparison follows the live Web `/b/[id]` path through `BookmarkArticleLocalFirst`, `BookmarkArticle.vue` and `useArticleSelection.ts`; it does not infer support merely from processor filenames. Claims below concern code paths, not a native reproduction of every content type.

## Mobile script ownership and generation

| Layer | Current location | Responsibility |
| --- | --- | --- |
| Portable bundled bridge | `packages/reader-embed/assets/js/webview-bridge.js` | `SlaxWebViewBridge`, DOM processors, selection, marks, image clicks and anchor search |
| Portable HTML shell | `packages/reader-embed/assets/html/webview-template.html` | Bridge injection, fixed reader layout and legacy YouTube iframe/timestamp integration |
| Mobile host adapter | `apps/mobile/assets/embedded/js/react-native-host.js` | Native transport, command lifecycle, size/touch reporting, image long press and host integration |
| Embedding generator | `apps/mobile/src/reader/generate-assets.mjs` | Reads portable assets and the Mobile host, checks portable provenance hashes and generates `embedded.generated.ts` |
| Generated runtime payload | `apps/mobile/src/reader/embedded.generated.ts` | Contains `readerAssets.bridgeJs`, `nativeHostJs`, the template and styles |
| Document composer | `apps/mobile/src/reader/document.ts` | Injects configuration/CSP, rewrites image transports and adds Mobile presentation CSS |

The sibling bridge builds `src/index.ts` through Rollup into `dist/slax-reader-web-bridge.js`. Its global export and processors correspond to the portable Mobile bridge. Mobile does not build or copy the sibling project automatically: its embedding generator reads the pinned package asset already in this repository.

## History: changes since Mobile was introduced

1. `11b1e506` (2026-10-12, author `daguang`) introduced `apps/mobile/assets/embedded/js/webview-bridge.js` with SHA-256 `cc943378a1de086b4dfc1c628e50618b187ae515fa256210bf2f51ac26038225`.
2. `b05c9d32` (2026-10-16, author `daguang`) moved it to the shared package with a Git `R100` rename. Current bytes have the same SHA-256. The source manifest records a byte-for-byte import from `slax-reader-client/public/embedded/js/webview-bridge.js`, source commit `9951904405159f49f24effd4d42815f77ff33442`.
3. The two historical versions of `embedded.generated.ts` retain that same `bridgeJs` hash. There is no current uncommitted diff to the portable bridge, the Mobile host adapter or the generated embedding.
4. The separate host adapter **did** change after introduction: `16aa25d1` (2026-10-16, author `daguang`) added image long-press handling, callout/drag suppression, cancellation on movement/multitouch, and suppression of the following tap/gallery click. This is Mobile host behavior rather than portable article preprocessing.
5. Current uncommitted changes in `document.ts` add Mobile selection/mark/timestamp color overrides. These are application-owned styles, not edits to the compiled bridge. The sibling README explicitly leaves CSS injection to the app.

Therefore, Git does not show post-introduction edits to the bundled portable bridge. Git alone cannot establish the editing method or who originally produced every imported difference.

## A source divergence already present at first import

An isolated development build of the sibling's **current source** was produced in a temporary directory using its existing dependencies and Rollup configuration with `ROLLUP_WATCH=true`. The sibling working tree and its existing `dist` were not modified. Comparing that output with Mobile's pinned script yields only the following functional difference group:

| Upstream source to reconcile | Additional behavior in Mobile's imported bundle |
| --- | --- |
| `src/features/scroll.ts`, `scrollToAnchor` | Optional callback immediately before programmatic highlighting |
| `src/features/selection-monitor.ts`, `SelectionMonitor` | `suppressedSelectionRange`, preparation/cancellation of pending user-selection work, range matching and suppression of programmatically created selections; resets on new user interaction and clearing |
| `src/core/slax-webview-bridge.ts`, `scrollToAnchor` | Wraps anchor navigation with `prepareForProgrammaticSelection()` and `suppressCurrentSelection()` |

This prevents outline/anchor navigation from opening user annotation controls merely because the navigation creates a DOM selection. It was already present in Mobile's **first imported bundle**; it was not added by this UI-polish task. The existing Mobile DOM regression `source outline anchors remain programmatic selections without opening annotation controls` exercises it.

Reconcile this group into bridge TypeScript **before** replacing Mobile's bundle with a fresh upstream build, or the behavior will regress. A future synchronization should port the behavior and its regression coverage, rebuild through Rollup, then update the imported asset/provenance and regenerate Mobile's embedding. This audit does not perform that synchronization.

The sibling's on-disk `dist/slax-reader-web-bridge.js` is also stale: it is a 36-KB file dated May 9, while source contains the July blank/preline/details additions. Its hash (`9960d867…`) differs from both the current source build (`1fa26f21…`, 130,426 bytes) and Mobile's pinned script (132,641 bytes). The stale local `dist` was not used as the source comparison baseline. Exact temporary build/diff evidence is at `/tmp/mobile-bridge-audit-build-path.txt`, `/tmp/mobile-bridge-audit-build.log` and `/tmp/mobile-bridge-source.diff`.

## Web processors absent from the bridge pipeline

Web registers 19 processors in `apps/web/app/composables/bookmark/useArticleSelection.ts`. Bridge has eight default processors and the separate InfoPack WeChat header processor. Eight Web processor categories have equivalents; eleven do not:

| Web processor | Missing bridge behavior | Porting consideration |
| --- | --- | --- |
| `AnchorProcessor` | Completes relative/root-relative article links using the original website origin; distinguishes in-page fragments from external targets | Mobile already intercepts external navigation, but that does not supply the original origin for unresolved relative links |
| `TableLayoutProcessor` | Detects tables that fit, applies `slax-table-fit`, and recomputes after resize/content changes without restructuring annotation-bearing DOM | General content-layout candidate; migrate the associated CSS and cleanup lifecycle together |
| `YoutubeProcessor` | Converts `youtube-player`, adds derived-article chapter seek controls, manages YouTube contents expansion/navigation, groups transcript cues, and wires keyboard/click seeking | Mobile has legacy `.slax-yt iframe` player/timestamp handling and native cue UI; this is missing **new-markup processing**, not total absence of YouTube support |
| `PodcastProcessor` | Converts `slax-media[data-kind="audio"]` to a player, binds paragraph media seeking and playback-following | Needs Mobile host/player decisions; native HTML audio alone is not this processing |
| `WechatVideoProcessor` | Converts `mp-common-videosnap` metadata to a visible author/video information component | Requires a portable or host-specific rendering component |
| `VideoProcessor` | Replaces general videos with the Web unsupported-video/poster action, except the X/Xiaohongshu host exceptions | Product/platform behavior, not a universal requirement to disable playable Mobile video |
| `IFrameProcessor` | Constrains numeric iframe widths greater than 100 to `100%` | General layout candidate; existing player-specific CSS is narrower |
| `TweetProcessor` | Removes `tweet-header` and renders footer interaction counts | Bridge image unwrapping is not equivalent to header/footer rendering |
| `SocialPostProcessor` | Renders social author/profile/footer metadata from custom tags and datasets | Requires the accompanying rendering/styles; no equivalent processor exists |
| `PhotoSwipeProcessor` | Adds slide dots/index selection, scroll synchronization and desktop mouse drag/click suppression | Mobile touch scrolling may work through CSS/browser behavior; dots/index synchronization are separate missing behavior; desktop mouse support is not automatically needed |
| `ClassIsolationProcessor` | Prefixes unreserved source classes with `oc-`, preserving KaTeX/reader/known content classes | Primarily prevents Web UnoCSS collisions. Mobile's isolated document does not share Web UnoCSS; do not copy without a demonstrated collision |

Web custom elements referenced here live under `apps/web/app/components/Article/CEComponents`. Copying processors alone would not provide those components or their styles.

## Existing processors with incomplete parity

| Category | Current difference | Consequence |
| --- | --- | --- |
| Images | Web preserves authored WeChat image styles/sizes, fills only missing padding/height, fits oversized fixed images, catches images already complete before handler registration, restores failed images after successful source replacement, clears obsolete preview handlers, and unwraps image links for both tweet and social-post cards. Bridge keeps the older overwrite-on-load model, no completion catch-up/recovery state, and tweet-only unwrapping | Candidate visual/loading defects include lost WeChat layout, persistent loading/hidden images and social image clicks also following enclosing links. These are code-level risks, not all reproduced defects |
| Empty spans | Web excludes spans containing `br` from its empty-span hiding. Bridge's visual-content exception omits `br` | A span used only for an explicit line break can be hidden by bridge processing |
| Details | Web leaves `.slax-yt-contents` under the YouTube processor's expansion policy; bridge opens every `details` containing a summary | New YouTube contents can be expanded contrary to the intended mobile default if that markup reaches the old bridge |

SVG filtering, UL `has-li`, blank-container markers, multiline paragraph markers and WeChat header hiding are already represented in the bridge. Blank/preline require their paired CSS, which is also present in Mobile's pinned article stylesheet; they are not missing features.

## Additional Web preparation, outside the processor count

- `/b/[id]` runs `runArticleSsrProcessors` on the server: class isolation and blank/preline marking before initial render. Bridge's DOM-only document has no SSR stage; existing client blank/preline processing already supplies the corresponding presentation, so server execution itself is not a Mobile omission.
- `BookmarkArticle.vue` calls `applyArticleImageLoading`: default lazy-loading attributes plus an optional first eligible article-image priority policy (`loading=eager`, `fetchpriority=high`) that preserves unrelated authored markup. This is absent from bridge source. Mobile's native image-cache/transports and Android full-height host differ; assess with Mobile loading measurements rather than copying Web's lazy-loading policy automatically.

## Suggested follow-up order

1. Reconcile the imported programmatic-selection fix into upstream source first so rebuilding is safe.
2. Evaluate common content correctness: image lifecycle/WeChat layout, `span > br`, iframe/table sizing and relative-link normalization.
3. Decide the Mobile presentation/player contracts for YouTube, podcasts, WeChat video and social cards, then port their processors and styles together.
4. Keep Web-only class isolation, SSR and desktop mouse behavior conditional on an actual Mobile requirement.

No synchronization, backend contract change or bridge replacement is authorized or performed by this audit.
