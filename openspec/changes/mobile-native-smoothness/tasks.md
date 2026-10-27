# Tasks

## 1. Contract and rules

- [x] 1.1 Archive the merged mobile performance, search, Spotlight and RSS-gesture changes, then confirm `openspec validate --all --strict` passes.
- [x] 1.2 Write the proposal, design and delta specs for this change.
- [x] 1.3 Replace the PDF SHA-256 verification sentence in `.rulesync/rules/mobile-architecture.md` with size/range/identity verification. Run `pnpm agent:sync` and confirm `pnpm exec rulesync generate --check` passes.

## 2. Native offline engine — iOS

- [x] 2.1 Add `SlaxOfflineEngine` (module, control queue, IO workers, ephemeral URL session) with the design's JS contract. No call blocks Expo's module queue.
- [x] 2.2 Implement article acquisition:
  - native HTML image-URL extraction;
  - an atomic manifest layout;
  - image acquisition through `SlaxImageRegistry` paths;
  - ported retry/backoff;
  - foreground `readArticle`/`fetchArticle`, `protect`/`release`, eviction and usage.
- [x] 2.3 Implement PDF metadata, range reads and resumable background acquisition, validated by size, Content-Range, length and identity, with no hashing.
- [x] 2.4 Implement credential generations, 401 rejection events, `SlaxStorageOwner` revocation and the one-time layout transition.
- [x] 2.5 Remove the `fingerprint`/`textFingerprint` hashing and the SHA-based staged-removal APIs from `SlaxFileStore`/`SlaxStorageModule`. Remove the JS-facing `SlaxPdfTransferModule` binding.

## 3. Native offline engine — Android

- [x] 3.1–3.5 Mirror tasks 2.1–2.5 in Kotlin: a single-thread control executor and an IO pool on the existing HTTP client, with the same contract and the same on-disk layout.

## 4. JavaScript data integration

- [x] 4.1 Add the `OfflineCoordinator` and the typed engine port. Plan diffs, batched one-transaction status persistence (deferred during interaction), eviction decisions, migration acknowledgement, credentials and lifecycle are wired through `data/runtime.ts`.
- [x] 4.2 Point Reader article reads and PDF ranges at the engine through the existing runtime methods.
- [x] 4.3 Delete the JS cache pipeline: `background-cache`, `resource-scheduler`, `offline-images`, `offline-tasks`, `offline-manifests`, `cache-evictions`, `pdf-cache`, `pdf-file-storage`, `pdf-acquisition`, `native-pdf-transfer` and `resource-fingerprint`.
- [x] 4.4 Remove all runtime SHA:
  - delete `pdf-sha256.ts`;
  - use primary-key Spotlight identifiers while still honoring legacy entries;
  - give avatar paths a non-hash identity;
  - delete the `fingerprint` manifest fields.
- [x] 4.5 Replace or remove the obsolete cache/PDF tests. Add coordinator, golden HTML-extraction and engine-host tests.

## 5. Library interaction

- [x] 5.1 Rewrite `SourceDrawer` as a single v3 pan: leading-edge `hitSlop` when closed, scrim inside the content, UI-thread hit testing, and no input-lock/gesture/boundary contexts.
- [x] 5.2 Rewrite the `BookmarkRow` swipe with `usePanGesture`: directional offsets, velocity settle and a threshold haptic. Remove the input lock and gesture relation, and attach the lift style only while the menu is open.
- [x] 5.3 Add `FeedList` (bounded-rate scroll sampling on a plain `FlatList`, constant visible-position policy, tuned batching, active-feed `scrollsToTop`) and use it in the Library and RSS feeds. Remove `drawerLocked`, the `scrollEnabled` toggle and `scrollToOffset`.
- [x] 5.4 Update the motion host mocks and the drawer/feed/list tests.
- [x] 5.6 After the build-787 review: switching an RSS source or Library list suspends visible-position adjustment until the replacement renders, so no scroll-to-top animation plays (with tests).
- [x] 5.5 After the build-785 review: fix separator-inclusive `getItemLayout`, make rows cheap at rest, and hold Library row updates while scrolling (with tests).

## 6. Lifecycle

- [x] 6.1 Pause only on `background`, add the shared `useAppForeground`, and gate the Library/RSS watches on focus plus foreground.
- [x] 6.2 Run the PowerSync import and schema construction concurrently at startup. Defer system-surface reconciliation until the Library is presented.
- [x] 6.3 Split `MobileContext` into services, settings and web session, and migrate the consumers.
- [x] 6.4 Make `RssController.update()` skip emissions when nothing changed.

## 7. Reader

- [x] 7.1 Derive `transitionReady` from `transitionEnd`/`gestureCancel`/the first route with a fallback. Mount the native host only after it, keeping the skeleton overlay until the document is presentable.
- [x] 7.2 Precompute the constant Reader template once per module, and dedupe identical `applyNativeInsets` calls.
- [x] 7.3 Guard iOS `updateInsets`: return early when unchanged, and defer the offset correction while tracking, dragging or decelerating.
- [x] 7.4 Measure Android content height natively and apply it on the UI thread without a per-change React render. Stop emitting a JS touch event on every `ACTION_MOVE`.

- [x] 7.5 After the build-786 review: keep the Reader navigation bar static from the first frame, read cached bodies on a foreground native queue concurrently with the record lookup, mount the iOS host immediately behind the cover, prewarm the Reader after the Library is presented, and shorten the cover fade (with tests).

- [x] 7.6 After the build-788 review, with tests:
  - restore the KMP outline and overview animations (settle-gated Markdown mount, skeleton/dots loaders, overview grow);
  - render outline Markdown with markdown-it;
  - hide iOS 26 scroll-edge effects.
- [ ] 7.7 Owner requirement (build-788 review): the Reader's top-left back button hides and shows together with the top-right More button. The build-789 attempt, which replaced the native header with a custom bar, was not approved and is reverted to the build-788 header. The implementation approach is pending the owner.

## 8. Verification and delivery

- [x] 8.1 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, `pnpm mobile -- test:native-resources`, `pnpm exec openspec validate --all --strict` and `git diff --check`.
- [x] 8.2 Run `pnpm mobile -- build:android` and `pnpm mobile -- build:ios` to compile both native targets.
- [x] 8.3 Run the local `REVIEW.md` review and resolve Important findings.
- [x] 8.4 Increment the Mobile `buildNumber`, regenerate native metadata, then archive, export and upload an iOS build to TestFlight for the owner's hands-on review. Nothing is pushed until the owner approves.
- [x] 8.5 Record the commands, the build number and the device acceptance that is still pending in `validation.md`. The owner tests the TestFlight build hands-on; no simulator or device is driven by the agent at the owner's instruction.

## 9. Archive

- [ ] 9.1 After the task pull request merges, archive this change through a docs pull request. Classify every unchecked task, including 7.7, before archiving.
