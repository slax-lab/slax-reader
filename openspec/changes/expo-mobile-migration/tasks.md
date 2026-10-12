# Tasks

## 1. Approval and source baseline

- [x] 1.1 Record human review approval of this proposal and the already approved runtime/plugin groups; verify the record identifies Expo SDK 57, iOS 16.4, navigation, WebView, and PowerSync/OP-SQLite without approving other plugins implicitly.
- [x] 1.2 Create `docs/mobile/migration-baseline.md` and a non-secret source manifest covering the audited commit plus dirty/untracked production files; verify RSS files/assets are included, hashes match the current source, and source files remain unmodified.
- [x] 1.3 Create the feature/state coverage ledger from the design's inventory, with original source paths and current platform gaps; verify every route, active subflow, and both locales have an explicit implementation/evidence status.
- [ ] 1.4 Prepare deterministic non-secret fixtures for library, collection, RSS, reader/marks/comments, AI, and account states; verify they drive repeatable source renders without depending on production account data.
- [x] 1.5 Verify Android emulator and iOS simulator/device availability and resolve the observed iOS runtime service failure; verify the original Android/iOS apps launch on identified targets and record any remaining unavailable runtime evidence.
- [ ] 1.6 Capture source native baselines for the coverage ledger using the fixture/device settings; verify every required state has an original render or is explicitly pending, with only documented narrow dynamic-content exclusions.

## 2. Expo and repository foundation

- [x] 2.1 Add the application-owned Expo SDK 57/React Native/TypeScript workspace and approved dependencies; verify compatible resolved versions, root pnpm installation, and absence of unapproved optional plugins.
- [x] 2.2 Configure Metro and native autolinking for the pnpm monorepo and public contracts boundary; verify Android/iOS bundle resolution and one React/React Native/native-library version without imports from other app internals.
- [x] 2.3 Add native Android/iOS projects with original app/share/group identifiers, Android API 26, iOS 16.4, callback relationships, and version strategy; verify manifests, target membership, entitlements, and isolated development builds without reading/copying signing secrets.
- [x] 2.4 Add root `pnpm mobile -- <command>` orchestration and application scripts for preparation, development, types, tests, and native builds; verify documented local/offline commands do not start other apps or deploy remote services.
- [x] 2.5 Establish platform interfaces, typed contracts/API client, environment selection, cancellation, and error mapping; verify representative requests and backend payloads match source fixtures and compile without browser-only APIs.
- [x] 2.6 Build and launch the isolated app foundation on Android and iOS before enabling legacy-data access; verify native module loading and capture actual launch evidence rather than relying on JavaScript bundling.

## 3. Mobile visual foundation

- [x] 3.1 Add the source-derived Mobile profile to `DESIGN.md` and application-owned colors/text/layout values; verify source measurements and separate Mobile/Web/Extension profiles in the delivered design/runtime files.
- [x] 3.2 Import original mobile raster assets with logical sizes and licensing/provenance records, and deterministically convert or retain required vectors; verify hashes/transformation output and original brand paint without an unapproved renderer.
- [ ] 3.3 Implement common dialogs, sheets, drawer, rows, buttons, input, loading/error/empty views, and system-bar/safe-area treatment; verify representative native renders against the source fixture measurements on both platforms.
- [ ] 3.4 Port Chinese/English strings and accessibility/test IDs; verify text expansion, accessible names/focus/touch targets, and platform font scaling in native fixture views.

## 4. Genuine native navigation

- [ ] 4.1 Register all nine source routes and persistent library/feed state using the approved native stack; verify genuine native headers/back controls and correct account root transitions on Android/iOS.
- [ ] 4.2 Implement source-order transient dismissal and unsaved-input interception for native header/system back; verify selection, image viewer, sheets, dialogs, drawer, and discard confirmation resolve without duplicate route pops.
- [ ] 4.3 Implement committed-exit cleanup and background position flush with interactive-cancellation handling; verify cancelled iOS swipe-pop leaves the reader active and committed return flushes/releases it exactly once.
- [ ] 4.4 Verify Android hardware/gesture/predictive-back and iOS button/swipe navigation across reader and non-reader routes; record native evidence that previous feed/list/scroll state is retained and auth/share callbacks cannot replay.

## 5. Upgrade and synchronization compatibility

- [x] 5.1 Locate the legacy database and cache paths in controlled original Android/iOS installations and compare supported PowerSync file/queue formats; deliver a documented, reproducible compatibility result before opening old files with a new owner.
- [x] 5.2 Implement the exclusive migration barrier and chosen supported adoption/export path, or narrow legacy-owner fallback; verify queued offline reads/writes survive cutover attempts without concurrent SDK owners or destructive database recreation.
- [x] 5.3 Implement native DataStore preference reading and shared-authentication migration with versioned journal/checkpoints; verify synthetic legacy protobuf fixtures retain every audited key and interrupted/repeated migration recovers without logging credentials.
- [x] 5.4 Implement the new PowerSync schema, connection/credential lifecycle, and local metadata access; verify schema/protocol parameters and complete local-bookmark JSON fields, including positions, profiles, and cache flags.
- [x] 5.5 Port ordered upload batching, transaction boundaries/pacing, metadata tag/share diffs, HTTP 400 isolation, and retryable failures; verify fixture tests include mixed valid/rejected transactions and completion only after successful upload.
- [x] 5.6 Implement persisted-session startup, refresh timing, token-matched 401 handling, logout/deletion/account switching; verify race tests cannot erase a newer token or render another account's data.
- [x] 5.7 Preserve or migrate HTML/image/AI caches and personal/collection keys with cache-limit/image preferences; verify offline fixtures and cache cleanup preserve local-only metadata and unsynchronized business writes.
- [ ] 5.8 Exercise old-app offline edits followed by interrupted and uninterrupted same-identity upgrades on both platforms; verify preferences, visible edits, operation identifiers/order, reading/cache state, and subsequent uploads, with no missing or duplicate logical operations.

## 6. Authentication and library

- [ ] 6.1 Before adopting provider plugins, ask for the exact proposed authentication group; record the answer and implement approved wrappers or source-equivalent native adapters, verified with the existing Android Credential Manager/iOS Google and iOS Apple backend payloads.
- [ ] 6.2 Port login presentation, agreements/terms/privacy, pending-provider action, cancel/loading/errors, and callback handling; verify both source providers on their supported platforms and native root reset after success.
- [ ] 6.3 Port inbox/starred/archive queries as source-ordered flat lists without date section headers, sync/avatar status, virtualization, and pending rows; verify live local/synchronized fixtures cover populated/empty/loading/offline/error states without inventing network pagination.
- [ ] 6.4 Port add-link/clipboard validation, optimistic creation, parsing progress/retry, and continue-reading banner; verify valid offline input and invalid/ambiguous input reproduce source behavior.
- [ ] 6.5 Port star/archive row swipe, context menus, title editing, and direct Library context-menu deletion without an added confirmation; verify local operations merge with delayed remote updates without duplicate or reverted rows. Preserve the separate Reader, comment, and account-deletion confirmations.
- [ ] 6.6 Port sidebar user/subscription states, feedback/settings/about/logout navigation, and platform promotion behavior; verify all drawer branches and logout/account cleanup in native runs.
- [ ] 6.7 Port collection feed selector, avatars/unread status, owner context, closed/expired/error fallback, and last-read behavior; verify shared permissions and cache ownership with personal and shared fixtures.

## 7. Complete RSS and Labs

- [ ] 7.1 Port RSS API/session-cache state, per-feed versions, Labs access, and enable/disable/error/retry behavior; verify source TTL and selected-feed behavior with deterministic fixtures.
- [ ] 7.2 Port subscription add/rename/remove forms and confirmation, all-feed/per-feed selectors, and source icon fallback; verify successful/error/empty states and list updates in native runs.
- [ ] 7.3 Port feed refresh, active/normal polling, rate-limit feedback, pagination/history/end/retry, and saved-entry cache updates; verify timers and entry saving follow source behavior without dropping current items.
- [ ] 7.4 Port RSS reader content/summary fallback, truncation/source metadata, original link, header/footer save controls, and gallery; verify full, truncated, loading, and error entries on Android/iOS.

## 8. Rich reader and native WebView gaps

- [ ] 8.1 Import pinned source HTML/CSS/JavaScript and implement the typed reader bridge; verify mixed-content and historical-mark fixtures retain document behavior and no plain-text rendering substitutes for rich HTML.
- [ ] 8.2 Implement native cached-resource handling/interception, streaming cancellation, origin fallback, and page teardown; verify offline HTML/images and cancelled requests on both native platforms without installed-package hand edits.
- [ ] 8.3 Implement source selection-menu suppression/placement, touch/scroll coordinates, and iOS `scrollsToTop` behavior; verify cross-paragraph handle dragging, menus after scrolling, and comment-panel interactions on both platforms.
- [ ] 8.4 Port article skeleton/header/source/refresh states, scroll-responsive toolbar, and personal/collection context; verify source native layout, permissions, and header/safe-area position across long/short articles.
- [ ] 8.5 Port arbitrary copy/highlight/comment actions and legacy path/offset/context range restoration; verify overlapping marks, selected text, mark click/removal, and historical fixtures do not shift or become whole-paragraph selections.
- [ ] 8.6 Port comment profiles/quotes/timestamps/thread expansion/replies/deletion and ownership restrictions; verify native thread actions attach to the correct author/range and denied actions remain unavailable.
- [ ] 8.7 Port comment input/reply prefixes, keyboard/focus, discard, nonempty validation, and the 1500-character limit; verify keyboard insets, dismissal, errors, and unsaved native-back safeguards in both locales.
- [ ] 8.8 Port tag manager/autocomplete/reuse/create/edit/remove and article title/star/archive/delete/cache/share/original/feedback actions; verify pending-local merges, confirmations, and permission restrictions.
- [ ] 8.9 Implement article/outline position adapters and source debounce/continue-reading persistence; verify immediate exit/background flush, reopening, and owner-aware restoration against the original Android/iOS scrolling models.

## 9. AI, images, video, and transcript

- [ ] 9.1 Port overview/key-takeaway streaming, summary expansion, cached/offline output, error/cancel states, and metrics; verify delayed/failed/complete streams and navigation cancellation against source fixtures.
- [ ] 9.2 Port Pro-gated outline generation, Markdown, collapsed/expanded/hidden states, anchors, and panel positions; verify entitlement gating, cached offline outlines, jumps, and restoration in native runs.
- [ ] 9.3 Before adopting any image/gesture/Markdown plugin, request its exact package group; implement approved capabilities or application-owned alternatives and verify source content/gestures without silently adding dependencies.
- [ ] 9.4 Port cache-aware fullscreen image paging/count/loading/dismissal and pinch/pan/double-tap zoom; verify source zoom ranges, adjacent-page transitions, and back priority on Android/iOS.
- [ ] 9.5 Port YouTube/player bridge and transcript current-cue positioning/seek/play; verify cue selection and supported playback preserve article, scroll, and transcript state on both platforms.

## 10. Settings, account, and auxiliary flows

- [ ] 10.1 Port cache-count options including unlimited, image-download preference, language, and Settings RSS entry; verify persistence and every option's enabled/disabled/error state in native runs.
- [ ] 10.2 Port account-deletion notice WebView, actual scroll-bottom gate, confirmation, progress/denials/errors, and successful sign-out; verify no delete request occurs before prerequisites and stale account state is cleared.
- [ ] 10.3 Port contextual feedback, follow-up selection, validation/submission/offline/retry/success states; verify sidebar versus bookmark context and source payloads with fixtures.
- [ ] 10.4 Port About/version artwork and five-tap debug entry; verify source layout, localization, and hidden-route activation in native runs.
- [ ] 10.5 Port diagnostic checks, cache cleanup categories, environment switching/restart and implemented shake entry; verify source results and lifecycle requirements with controlled endpoints without exposing secret values.
- [ ] 10.6 Before adopting files/clipboard/haptics/localization/network/secure-storage/sensors plugins, ask for exact needed packages; implement approved or source-native interfaces and verify each required source behavior through its calling flow.

## 11. Native share, subscriptions, and telemetry

- [ ] 11.1 Port the standalone iOS share target with original identity/App Group, shared auth, Safari preprocessing, and source 180-point result UI; verify collection success/error/cancel and expired/absent auth while the main app is closed.
- [ ] 11.2 Port Android incoming text/plain URL/subject sharing and result/dismissal handling; verify shares from other apps do not corrupt navigation or account state.
- [ ] 11.3 Port outbound native title/text/URL and iOS image metadata sharing; if a plugin is needed, obtain approval first, then verify actual native share sheets preserve source platform behavior.
- [ ] 11.4 Before adopting an IAP plugin, request exact packages and verify signed-offer capability; port approved wrappers or StoreKit-native adapters, with product/JWS/order UUID/appAccountToken fixture checks.
- [ ] 11.5 Port authenticated subscription WebView/cookie bridge and purchase/verification lock; verify product/offer requests, normal success/error/pending/cancel, source Android limits, and account isolation.
- [ ] 11.6 Verify StoreKit transaction listener, existing restore/entitlement integration, revocation, offers, and backend validation in controlled sandbox scenarios; record evidence and keep unavailable signed/account tests explicitly pending.
- [ ] 11.7 Before adopting Firebase plugins, request the exact group; port approved wrappers or native SDK adapters and first-party reporting, verified by manual screen/events, stable analytics ID, and source automatic-screen-reporting configuration.
- [ ] 11.8 Verify native crash reporting in an appropriate release build and telemetry across launch/login/background/navigation; record observable delivery without treating a development overlay as crash-reporting proof.

## 12. Complete native visual and interaction acceptance

- [ ] 12.1 Compare login, library, drawer, collection, sync, and their dialogs against matched source Android/iOS baselines in Chinese/English; resolve text/geometry/assets/color differences and attach state-indexed evidence.
- [ ] 12.2 Compare RSS/Labs subscriptions, list/history/refresh states, and RSS reader against matched source baselines; resolve differences including loading/error/truncation/save/gallery states and attach evidence.
- [ ] 12.3 Compare article/AI/outline/tools/tags and all selection/comment/input overlays against matched source baselines; resolve coordinates, wrapping, keyboard, permissions, and scroll differences, with only the agreed narrow native-back exception.
- [ ] 12.4 Compare image/video/transcript, settings/deletion, subscription, feedback, About/debug, and iOS share states against matched source baselines; resolve differences and attach state-indexed native evidence.
- [ ] 12.5 Exercise complete account/library/collection/RSS/reader workflows, accessibility scaling, motion, background/resume, native back/swipe cancellation, and offline/reconnection on both platforms; verify the coverage ledger has no missing functional or render states.

## 13. CI, documentation, and final delivery

- [ ] 13.1 Add mobile-focused static/fixture/native-build CI with suitable runners and path selection; verify representative mobile-only and root-dependency changes preserve existing API release eligibility and report actual mobile checks.
- [ ] 13.2 Write English mobile setup, plugin approval ledger, architecture, upgrade/recovery, source/asset provenance, and local/build/release guides through the root command; verify each documented command and clearly identify operator-managed configuration without secret content.
- [ ] 13.3 Run final Android/iOS development builds and iOS Release/archive validation, types, meaningful data/bridge tests, strict OpenSpec validation, and controlled upgrade verification; attach command/device/version results and do not mark unavailable runtime/signed checks complete. The final release delivery is iOS-only; no Android release package is required.
- [ ] 13.4 Read `REVIEW.md` and complete its local pre-push review/compliance passes; resolve Important findings, verify the PR body includes `OpenSpec: expo-mobile-migration`, and create/attach the task PR targeting `dev` without public App Store publication or backend production deployment.
- [ ] 13.5 Deliver the explicitly authorized publisher-signed iOS preview `1.0.25 (760)` main/share application to the existing TestFlight app using opaque Apple tooling; verify artifact identities/entitlements/version, record upload and Apple processing/TestFlight status, and retain unfinished migration/telemetry acceptance without public App Store publication.

## 14. Reviewed parity regression repairs

These focused repairs address the October 11 source comparison. Their host-level regression results do not complete the broader native acceptance requirements above.

- [x] 14.1 Restore agreement disagreement/dismissal semantics, nonempty title submission, source UTC timestamp parsing, RSS draft/editor behavior, iOS middle ellipsis, and Subscription title typography; add focused production-component/function regression tests.
- [x] 14.2 Preserve legitimate Android multi-user legacy database ownership and bounded legacy image-cache reads on JavaScript/Android/iOS; restore source handling of absent image Content-Type and verify safe-path, ownership, and cache regression cases.
- [x] 14.3 Restore lifecycle-scoped personal/collection comment stream subscriptions with source parameters and TTL; verify permission changes, delayed subscriptions, failures, cleanup, and account revocation through actual repository/lease code.
- [x] 14.4 Restore fresh-selection comment panel reconciliation, comment/reply copy menus, source comment/outline presentation, inactive-gallery zoom reset, and direct original/confirmed body-link in-app browsing; add focused regression coverage.
- [ ] 14.5 Bind privileged Reader command results to native evaluation completion and active document/account lifetimes rather than generic page messages; verify forged, stale, subframe, and disposed responses cannot complete privileged requests while legitimate commands remain functional.
- [ ] 14.6 Run full mobile checks, source baseline verification, native-resource tests, strict OpenSpec validation, Android Debug and iOS Release validation builds on the integrated repair; execute available controlled native scenarios and review Bugs/Security/Compliance findings, retaining unavailable native acceptance explicitly pending.
- [ ] 14.7 Resolve reviewed Reader origin-isolation gaps; verify untrusted article content, frames, and navigation cannot acquire authenticated application-origin access or privileged native capabilities while supported reader content remains functional.
- [ ] 14.8 Resolve reviewed modal interaction and dismissal gaps; verify native back, outside dismissal, and unsaved-input safeguards against the existing source behavior without duplicate navigation or lost edits.
- [ ] 14.9 Verify release admission for configured main and standalone Share Firebase resources, target membership/linkage, bootstrap, main crash-symbol upload, and artifact metadata without inspecting configuration contents; exercise missing/stale-input rejection and a fresh configured `1.0.25 (758)` archive with previous-build bound `757`. Keep missing operator paths and native telemetry delivery pending until independently verified.

## 16. Main-checkout UI refinements

The user requested sequential, single-process work in the main checkout on local `dev`; no new worktree, subagent or direct commit to the long-lived branch is part of this pass.

- [x] 16.1 Restore visible Reader more/archive image assets in actual iOS presentation and cover the header/floating-button layout boundary.
- [x] 16.2 Render an unanimated default/blank startup surface without a loading spinner; show safe available content immediately without exposing a previous account.
- [x] 16.3 Move collection/feed selectors into the vertical list header so they can scroll offscreen, preserving horizontal selection, list anchoring and restoration; omit the whole collection strip when no collections exist.
- [x] 16.4 Keep add-link opening quiet when the clipboard contains no URL, retain explicit submit validation, and prevent late clipboard reads from overwriting input.
- [x] 16.5 Keep transparent iOS backdrops stationary while independently animating sheet/menu content; preserve native dismissal completion, keyboard and reduced-motion behavior without a gray sliding pseudo-panel.
- [ ] 16.6 Run focused regressions, standard checks/build and native visual interaction verification for these six requested refinements; keep unavailable evidence explicit.

Build 760 verification: 587 host tests and TypeScript passed, the isolated iOS app built and displayed the Reader header more icon and floating/menu archive artwork, and the bottom menu opened through the real header control. Full native motion/long-list/profile acceptance remains incomplete. Publisher-signed main/share build 760 passed identity/signature/App Group checks and Apple accepted the explicitly authorized TestFlight preview upload; processing availability is separate.

## 15. TestFlight stability and performance follow-up

- [x] 15.1 Correct iOS ownership/background locking and bounded write lifetimes without losing pending operations or account isolation; verify startup, suspension, expiration and rapid resume races through actual lifecycle/ownership code.
- [x] 15.2 Avoid repeated migration-scale inventory/hash work for safely recognized adopted installations while retaining first/interrupted/changed-format checks and recoverability.
- [x] 15.3 Move row/drawer finger tracking to approved UI-thread gesture primitives, coordinate vertical scroll and horizontal actions, fix interrupted settling and scroll restoration edge cases, and reduce avoidable list row work.
- [x] 15.4 Remove artificial Reader readiness waits and separate cached content/position from optional work; ensure static outline scrolling never rebuilds its content and verify restored positions and failed-cache paths.
- [x] 15.5 Eliminate per-scroll React rendering and duplicate Reader event work where unnecessary; preserve native position/selection geometry and bounded foreground WebContent recovery.
- [ ] 15.6 Suppress the Reader's duplicate native edit menu using supported APIs while preserving selection handles, cross-paragraph annotation and normal comment-editor actions; verify with actual iOS interaction evidence.
- [x] 15.7 Suppress no-op preference/device-ID writes and equivalent repository emissions, stabilize provider/row identities, and verify account-scoped cancellation and real update delivery.
- [ ] 15.8 Run focused and full regression, native host checks, native builds and the five reported runtime scenarios; record Release performance evidence or exact device limitations without claiming unmeasured FPS or a proven crash cause.

Performance follow-up validation: 582 host tests, TypeScript, bundle generation, Android Debug and iOS Release simulator builds pass. Seven selected iOS UI cases have passing records across the initial run and the final comment-editor rerun: Reader inspection, genuine word selection, highlight/reselection, comment-editor native copy/paste/submission, Library background/resume, scrolled Reader background/resume, and three cached article round trips. The absence assertion reads actual public accessibility snapshots and permits only identified application actions. Historical failed harness runs are retained separately. Local evidence is under `.local/mobile-performance-20261011/`.

The isolated UI app retained its process across observed 30-second background/suspension intervals, but does not exercise production App Group database ownership. Final runtime lifecycle changes compiled in the separate Release validation build and passed native SQLite/ownership host checks, not a physical iPhone suspension test. Cross-paragraph native handle dragging, overflowing-list gesture arbitration, and matched Release frame-time/latency profiling remain pending. No FPS improvement, physical-device crash diagnosis, or full KMP equivalence is claimed. The new app has not been uploaded to TestFlight in this performance pass.

October 11 repair validation: 461 host tests and TypeScript pass after correcting an Android-observed Outline animation driver conflict. The isolated Android rerun reaches Reader, completes native evaluation callbacks, and captures prepared comment/outline/gallery states without that crash. Prepared frames do not verify physical selection gestures, title-editor keyboard submission, or RSS draft typing. Both native platforms compiled, and the final iOS Release simulator validation rebuild passed with the JavaScript-only animation correction embedded. The Android native inputs remained unchanged; its recorded JavaScript revision passed the controlled Reader rerun. The allocated iOS simulator cannot boot because its data directory is missing. Native iOS execution and the complete matched visual/interaction matrix remain pending. Local raw logs, source-revision hashes and screenshots are retained under `.local/mobile-parity-repairs-20261011/`; they are not committed acceptance records or a TestFlight upload receipt.
