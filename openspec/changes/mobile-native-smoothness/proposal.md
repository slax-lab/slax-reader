# Proposal

## Why

The Expo mobile app feels markedly less smooth than the previous Kotlin Multiplatform (KMP) app. Library scrolling stutters and loses momentum, row taps can show the pressed state without opening the Reader, the first drawer opening can leave input on the covered list, and the Reader stutters while opening and scrolling. Comparison with the KMP source (`slax-reader-client` at the migration baseline), Bluesky's open-source Expo/RN 0.88 app and mature readers (NetNewsWire, Omnivore) shows the common cause: work the KMP app ran on platform threads or received from platform components now runs on the single JavaScript thread that also delivers taps and navigation. That work is automatic caching, SQL result diffing, hashing, drawer and gesture arbitration, and WebView height layout.

## What Changes

- Move automatic offline acquisition (article body, image and PDF fetch, HTML preparation, atomic file writes, retry/backoff, eviction) into an app-owned native engine. It runs on separate IO and CPU workers (Kotlin coroutines on Android, a Swift actor plus task groups on iOS) with KMP-equivalent concurrency. PowerSync remains the only database writer. The engine reports batched progress, and JavaScript persists each batch in one transaction, writing download state at most twice per article.
- Remove all SHA computation from the mobile runtime. Spotlight/App Intents identifiers use bookmark primary keys. Cache paths and avatar identities use account, bookmark and user keys. Article completion uses an atomic manifest plus size and `updatedAt`. PDF completion uses descriptor size, Content-Range/length and the opaque descriptor identity, plus the ETag when supplied.
- Rebuild Library interaction on proven patterns:
  - **Drawer:** a single-pan drawer modelled on `react-native-drawer-layout`. It opens from the left edge, as in KMP, uses a scrim that owns input, and sets content hit testing from UI-thread state. Explicit list input locks and scroll resets are removed.
  - **Rows and list:** swipe rows use the RNGH 3 hook API with directional activation (Bluesky `GestureActionView`), and taps are never silently swallowed. The list wrapper uses UI-thread scroll handling, a constant visible-position policy and tuned batching.
  - **Native affordances:** iOS status-bar scroll-to-top and swipe-threshold haptics are restored.
- Align lifecycle with KMP:
  - Startup presents from local login state while the remaining startup steps run in parallel.
  - Only a true background transition engages the storage-safety pause. Sync, caching and watchers are no longer torn down for iOS `inactive`.
  - Non-critical work starts when the Library is presented.
  - Preference writes no longer re-render the whole tree.
- Reader:
  - **Open:** on Android the native document host mounts after the push transition. On iOS it mounts immediately, because the push is Core Animation driven. In both cases the article shows as soon as its HTML is ready, with no loading cover, and the saved position is restored once at DOM readiness. Static bridge/host scripts are installed once, and cached bodies are read on a foreground native queue concurrently with the record lookup. The Reader module and WebKit are prewarmed after the Library is presented.
  - **Header:** the native Reader header options are static from the first frame, and iOS 26 scroll-edge effects are hidden.
  - **AI surfaces:** the outline mounts its Markdown after its motion settles. KMP's loading animations are ported, the overview grows from its excerpt, and outline Markdown is rendered by `markdown-it` with `markdown-it-cjk-friendly`, at the versions the Web app already uses.
  - **Platform fixes:** Android measures document height natively instead of round-tripping through React layout. iOS inset updates no longer reset the offset or stop deceleration when unchanged or while scrolling.
- Archive the prior mobile performance, search, Spotlight and RSS-gesture changes before this work. Their remaining device acceptance is re-exercised here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-performance-lifecycle`: adds native offline-engine thread ownership, batched progress persistence, key-based identities without hashing, KMP-aligned background/foreground behavior and post-transition Reader host mounting with native Android height and iOS inset guards.
- `mobile-app-parity`: the drawer no longer locks the covered list. Its scrim owns input while the drawer is visible, and PDF completion no longer requires a full-file hash.
- `mobile-visual-parity`: drawer, row swipe and list motion follow the single-gesture, UI-thread model, with no feed input lock.
- `mobile-reader-parity`: PDF completion is verified by size, range/length and descriptor identity instead of SHA-256. Article presentation shows the HTML host directly once ready, without a loading cover or waiting for external resources.

## Impact

- Native modules: `apps/mobile/modules/slax-platform` (new offline engine on iOS and Android, Reader host height/inset/script changes) and `slax-legacy` (hash helpers removed).
- Dependencies: `markdown-it` 15.0.2 and `markdown-it-cjk-friendly` 3.0.0, already resolved in the lockfile for the Web app.
- JavaScript: `src/data/*` (the cache pipeline is replaced by an engine facade; SHA helpers deleted), `src/system-actions/*`, `src/components/{SourceDrawer,BookmarkRow,RssFeed,feed-scroll}`, `src/screens/LibraryScreen.tsx`, `src/runtime.tsx`, `src/data/runtime.ts`, `src/reader/*`.
- Rules: `.rulesync/rules/mobile-architecture.md` PDF verification sentence (regenerated with `pnpm agent:sync`).
- Existing offline article caches are invalidated once and re-acquired in the new layout.
- The iOS build number increments for a TestFlight build.
