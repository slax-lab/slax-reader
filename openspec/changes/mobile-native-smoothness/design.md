# Design

## Context

The KMP app kept its UI thread for rendering and gestures and ran data/cache work on `Dispatchers.IO`. In the Expo app the following run on the single JavaScript thread that also delivers taps and navigation:
- automatic caching (`background-cache.ts` and helpers, about 2,200 lines);
- watch diffing;
- JavaScript SHA-256;
- drawer and row gesture arbitration (`SourceDrawer`, `BookmarkRow`);
- Android Reader height layout.

Reference implementations:
- KMP `Background.kt`: `Channel(100)` + `flatMapMerge(3)` on IO, two download-state writes per article.
- KMP Material3 drawer with a 50dp edge detector.
- Bluesky social-app on the same Expo 58 / RN 0.88 / RNGH 3.3 / Reanimated 4.7.1 stack: `react-native-drawer-layout` single pan, `GestureActionView`, and a `List` wrapper with a UI-thread scroll handler.
- NetNewsWire and Omnivore WebView readers.

## Goals / Non-Goals

**Goals**
- Keep the JavaScript thread idle during interaction.
- Move offline acquisition to native IO/CPU workers.
- Remove runtime hashing.
- Make drawer, row and list gestures UI-thread and conflict-free.
- Align lifecycle with KMP.
- Defer heavy Reader work until after the transition.

**Non-Goals**
- Moving PowerSync or repositories to native.
- Replacing FlatList.
- Enabling Reanimated synchronous-props flags.
- Patching dependencies.
- Adding `androidx.webkit` prewarming.
- A new asset URL scheme.

## Decisions

### 1. Native offline engine (`SlaxOfflineEngine`, `modules/slax-platform`)

- **Planning stays in JavaScript.** `cache-plan.ts` and the `cache-state` watches remain. A new `OfflineCoordinator` (`src/data/offline-coordinator.ts`) replaces `BackgroundArticleCache`. It sends plan diffs to native, persists batched status events in one transaction and owns eviction decisions, credentials and lifecycle.
- **Native never opens the PowerSync database.** This avoids WAL contention and a lease bypass.
- **Workers:**
  - iOS: a serial control queue, an IO `OperationQueue` and an ephemeral `URLSession`.
  - Android: a single-thread control executor, an IO pool and the existing OkHttp client.
  - Every Expo `AsyncFunction` hands off immediately, so Expo's serial module queue is never held.
- **Concurrency:** articles run 3 per domain, plus one reserved foreground slot. Images go through `SlaxImageRegistry`, with at most 2 per host. Retry and backoff constants are ported from `offline-retry.ts`.
- **HTML handling:**
  - Raw HTML is stored verbatim. The Reader already applies `rewriteReaderImageTransports` on every open, and that rewrite is idempotent.
  - Native only extracts image URLs, following JavaScript tokenizer rules. A shared golden fixture keeps parity.
  - Image paths reuse the existing KMP-compatible `bookmark/<key>/images/<md5>.<ext>` layout, so the Reader's scheme handler is unchanged.
- **Article record:**
  - Each article has a `bookmark/<key>/offline.json` manifest: version (bookmark `updated_at`), size, per-image state and retry state. Files are committed with temp-file-then-rename.
  - An article is complete when its size matches and its version is unchanged.
- **PDF:**
  - Metadata, range reads and background acquisition move into the engine, using `pdf/v2/<scopeId>/<key>/`. `scopeId` is the base64url scope JSON, so no hashing is needed.
  - Validation covers 206, Content-Range, total size, media type, length and any contradictory ETag. `document_id` is treated as an opaque identity string.
  - `SlaxPdfTransfer` remains an internal helper. The JavaScript `pdf-cache` and `pdf-file-storage` code and the SHA steps are deleted.
- **Foreground reads:**
  - The runtime's `readArticle` and `getArticleContent` call native `readArticle` / `fetchArticle`. Native serves the cached file or fetches it at foreground priority.
  - Article access protection maps to native `protect` / `release`.
- **Credentials:**
  - JavaScript pushes `{generation, token}` while credential readiness is `ready`, and `null` otherwise.
  - A 401 response emits `onCredentialRejected{generation}`. JavaScript rejects only a matching session and pushes a new generation after refresh.
  - Native holds the token in memory only and never logs it.
- **Revocation:** account revocation follows `SlaxStorageOwner` observers. Every engine write commits under the current storage lease.
- **Status reporting:** `onStatus` events are coalesced to at most one per 250 ms per owner. JavaScript defers persisting them while the Library is scrolling or a route transition is running.

### 2. Removing runtime hashing

| Area | Change |
|---|---|
| `pdf-sha256.ts` | Deleted. |
| Spotlight / App Intents | IDs become `b-<id>`. Legacy `catalogIdMap` entries are still honored, so already-donated identifiers keep resolving. |
| Avatar paths | Use the existing MD5 path helper with `identity + timestamp`. |
| Native `fingerprint` / `textFingerprint` | Removed. |
| Retained (flagged in tasks) | One-time legacy adoption checksums, the legacy preference import fingerprint (it runs only before the migration marker exists) and the per-process rule-list name are non-normal-path uses. |

### 3. One-time cache layout transition

When the engine marker is absent, native:
- deletes `pdf/v1`;
- deletes staged-eviction receipts;
- adopts complete regular `bookmark/*/content.html` files into manifests, since they were already atomically written.

JavaScript then clears obsolete `_slax_offline*` JSON fields, resets the download state of dropped entries in one lease-checked transaction, and commits the marker. The transition is idempotent if interrupted.

### 4. Library interaction

- **`SourceDrawer`** is rewritten on the `react-native-drawer-layout` `Drawer.native` model:
  - One RNGH v3 `usePanGesture`.
  - When closed, `hitSlop` limits the gesture to a 32pt (iOS) or 50dp (Android) leading edge. It activates on rightward movement, fails on leftward movement and has a vertical fail offset.
  - When open, the gesture covers the full surface.
  - The scrim and dismiss surface live inside the content view. Hit testing and accessibility hiding come from `useAnimatedProps`.
  - The existing settle rule is kept: velocity of at least 400 decides, otherwise progress of at least 0.5.
  - `DrawerInput`, `DrawerGesture`, `DrawerScrollBoundary` and `onInteractionChange` are removed.
- **`BookmarkRow`** uses `usePanGesture` and is cheap at rest: no shared-value writes on mount, one animated style, swipe buttons and the title-flash overlay mounted only while needed (row accessibility actions cover star/archive):
  - Directional `activeOffsetX` (±10), `failOffsetY` (±10), velocity settle and one haptic per threshold crossing.
  - No input lock and no gesture relation.
  - The lift shadow style is attached only while the menu is mounted.
- **New `FeedList`** follows Bluesky's `List` list settings, on React Native's plain `FlatList` (no scroll-driven animations need a UI-thread handler, and Reanimated's list wraps every cell in an extra animated view):
  - JS scroll events throttled to 48 ms; begin-drag, end-drag, momentum-begin and momentum-end are always forwarded.
  - `getItemLayout` reports each row's length including its separator, so virtualization spacers match the rendered rows exactly.
  - While the feed is scrolling, Library row publications are held and the latest is applied when scrolling settles.
  - A `contentScope` prop (the RSS source, the Library list) turns `maintainVisibleContentPosition` off from the switch until one frame after the replacement rows render (at most 1 s). A swapped data set is otherwise treated natively as a prepend, which triggers `autoscrollToTopThreshold`'s animated scroll to the top.
  - A constant `maintainVisibleContentPosition`.
  - `windowSize` 9, `maxToRenderPerBatch` 5 on iOS and 1 on Android, and `removeClippedSubviews`.
  - `scrollsToTop` only on the active feed (other iOS scroll views are set to false), with `onScrollToTop`.
  - The Library screen removes `drawerLocked`, the `scrollEnabled` toggle and `scrollToOffset`.

### 5. Lifecycle

- **Foreground state:**
  - `runtime.setForeground(state !== 'background')`. `StorageLifecycle.swift`'s `willResignActive` grace task is kept as the storage safety net.
  - A shared `useAppForeground` replaces per-screen AppState listeners. Library list watches still suspend while covered or backgrounded.
- **Startup:**
  - The PowerSync module import and schema construction start concurrently at `start()`.
  - Ownership and adoption ordering is unchanged.
  - System-surface reconciliation waits for `markLibraryPresented`.
- **Context split:** `MobileContext` is split into services, settings and web session, so preference writes re-render only settings consumers.
- **RSS:** `RssController.update()` emits only when a value actually changed.

### 6. Reader

- **Route transition:**
  - `useReaderLifecycle` removes the `requestAnimationFrame` shortcut. `transitionReady` comes from `transitionEnd` (not closing), `gestureCancel` or the first route, with a 600 ms fallback.
  - On Android, `ReaderContent` mounts the native host only after `transitionReady`. On iOS it mounts at once, because the push is Core Animation driven; the cover hides it in both cases.
  - The Reader route's native header options (transparent bar, no shadow, fixed 48×44 trailing slot) are static from the first frame, so the back button never moves during the push.
  - `scrollEdgeEffects` are hidden on every edge of the route, and `SlaxReaderView` also hides its own scroll view's iOS 26 edge effects. This removes the scroll-edge band under the bar.
  - Cached bodies are read on a dedicated user-initiated native queue, not the shared background IO queue. The record lookup and the cache read start concurrently.
  - Once the Library is presented, an idle callback preloads the Reader module. On iOS it also compiles the content rule list and creates and discards one WKWebView to warm WebKit; that view is never reused for a document.
  - The cover fade is 120 ms.
  - The initial restore, and therefore the cover, waits for `domReady` and the first document height, not the WebView load event. Slow external images, frames or fonts no longer hold the article covered. A saved position above 0 is reapplied once if the document grows before the user interacts, until the load event or 2 s. A 1.5 s timeout lifts the cover in any case.
  - A skeleton overlay covers the host until `documentReady` and the initial position restore, then fades out (reduced-motion aware).
- **Document composition:** `composeReaderDocument` precomputes the constant template prefix and suffix at module scope, so each open only concatenates the article.
- **iOS `SlaxReaderView.updateInsets`:**
  - Returns early when the insets are unchanged.
  - While the user is tracking, dragging or the view is decelerating, it stores the offset correction and applies it when scrolling ends. It never calls `setContentOffset` during a gesture.
  - On the JavaScript side, `applyNativeInsets` skips identical calls.
- **Android `SlaxReaderView`:**
  - Measures content height natively and emits a deduplicated `onContentHeight` event, at most once per frame.
  - The Reader applies the height to the WebView through a Reanimated event handler or animated style on the UI thread, so there is no per-change React render.
  - The JavaScript `touch` event is sent only on DOWN, UP and action-mode transitions, not on every `ACTION_MOVE`.

### 7. Reader AI surfaces

- **Outline motion.** The outline mounts its Markdown WebView only after its open/expand motion settles, as KMP does with `transitionState.isIdle`. Creating the WebView mid-transition otherwise drops the slide and morph frames.
- **Loading animations.** KMP's skeleton, dots-line and dots-ring loading animations are ported with Reanimated.
- **Overview dialog.** It grows from the excerpt's frame, a 250 ms FastOutSlowIn scale with a 300 ms fade, and reverses before it closes.
- **Markdown.** Outline Markdown is rendered by `markdown-it` with `markdown-it-cjk-friendly`, at the versions the Web app already resolves, instead of a hand-written regex converter. Settings are `html: false`, links limited to http(s) and `#`, and block-level incremental DOM updates during streaming.

## Risks / Trade-offs

- **Native URL extraction drift** causes offline image misses. Mitigated by the golden fixture parity test.
- **Removing the full-file hash** means a same-size corrupt PDF is no longer detected. The user accepted this; size, range and identity checks remain.
- **A constant `maintainVisibleContentPosition`** may interact with saved-offset restore. Restore tests are kept.
- **The first launch after upgrade** re-downloads PDFs and any article that cannot be adopted.
- **This is a large native surface.** Both platforms must compile through `build:ios` / `build:android` before TestFlight. Device acceptance is recorded separately in `validation.md`.

## Migration Plan

1. Land the engine, coordinator and SHA removal together.
2. Rebuild Library interaction.
3. Apply the Reader and lifecycle changes.
4. Update the rules (the `.rulesync` PDF verification sentence) and docs.
5. Run the checks, bundle and native builds.
6. Bump `buildNumber` and upload a TestFlight build for the owner's hands-on review. On 2026-10-27 the owner instructed: build TestFlight, push, and open the pull request.

Rollback: revert the branch. The cache layout transition only deletes rebuildable cache data.

## Engine contract

```ts
// src/data/offline-engine.ts — typed port over requireNativeModule('SlaxOfflineEngine')
export interface OfflineScope {owner: string; scope: string /* JSON [origin,userId] */; origin: string; directory: string;
  userAgent: string; clientType: 'ios'|'android'; clientVersion: string}
export interface OfflineTask {key: string; id: string; collectionOwner?: string; kind: 'article'|'pdf'; manual: boolean; version: string /* bookmark updated_at */}
export interface OfflinePlan {revision: number; upsert: OfflineTask[]; remove: string[]}
export type OfflineState = 'downloading'|'complete'|'failed'|'denied'|'invalidated'|'evicted';
export interface OfflineStatusEvent {owner: string; items: {key: string; state: OfflineState; manual: boolean; retryAt?: number; code?: string}[]}
export interface OfflineCredentialRejected {owner: string; generation: number}
export interface SlaxOfflineEngineNative {
  open(scope: OfflineScope): Promise<{adopted: string[]; dropped: string[]; migrationPending: boolean}>;
  commitMigration(owner: string): Promise<void>;
  suspend(owner: string): Promise<void>;
  resume(owner: string): void;
  close(owner: string): Promise<void>;
  setCredential(owner: string, credential: {generation: number; token: string} | null): void;
  setConditions(owner: string, c: {online: boolean; downloadImages: boolean}): void;
  applyPlan(owner: string, plan: OfflinePlan): void;
  evict(owner: string, keys: string[]): Promise<string[]>;
  protect(owner: string, key: string): string; release(owner: string, token: string): void;
  readArticle(owner: string, key: string): Promise<string | null>;
  fetchArticle(owner: string, r: {key: string; id: string; collectionOwner?: string; requestId: string; force: boolean}): Promise<string>;
  pdfMetadata(owner: string, r: {key: string; id: string; collectionOwner?: string; requestId: string; allowNetwork: boolean}): Promise<PdfDescriptor>;
  readPdfRange(owner: string, r: {key: string; id: string; collectionOwner?: string; documentId: string; size: number; begin: number; end: number; requestId: string}): Promise<Uint8Array>;
  pdfStatus(owner: string, key: string): Promise<{downloadedBytes: number; totalBytes: number; complete: boolean}>;
  cancel(owner: string, requestId: string): void;
  usage(owner: string, keys: string[]): Promise<{article: number; images: number}>;
  clear(owner: string, keys: string[], categories: ('article'|'images')[]): Promise<string[]>;
}
// Events: 'onStatus' (coalesced ≤1 per 250 ms per owner), 'onCredentialRejected'
```

On-disk layout (root = existing data directory):

```
bookmark/<key>/content.html          raw response bytes, temp+rename
bookmark/<key>/images/<md5>.<ext>    unchanged KMP-compatible image paths
bookmark/<key>/offline.json          {v:2,id,owner,kind,version,size,images:[{u,s,a,t}],retry:{a,t,denied}}
pdf/v2/<scopeId>/<key>/descriptor.json
pdf/v2/<scopeId>/<key>/document.pdf  complete; .part + part.json {document_id,size,committed} while acquiring
offline-engine.json                  {layout:2}
```

Requests mirror `src/data/api.ts`: article body is `POST /v1/bookmark/content {bookmark_uid}` (collection variant per the existing collection content call), `Accept: */*`, Bearer token, the same client headers and timeouts; PDF uses `/v1/bookmark/metadata` and `/v1/bookmark/pdf` exactly as `SlaxApi` does today.
