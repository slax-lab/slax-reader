# Design

## Context

See `proposal.md` for motivation and the six capability deltas for acceptance requirements. The source is the current Android/iOS Kotlin Multiplatform application in `../slax-reader-client`: commit `9951904405159f49f24effd4d42815f77ff33442` plus modified and untracked production files. The overlay includes RSS and collection changes. A checkout of that commit alone is not the migration baseline.

The source combines Compose presentation, PowerSync, protobuf DataStore preferences, shared HTML/JavaScript, Android WebView, customized WKWebView, a standalone iOS share extension, and Swift StoreKit integration. The monorepo uses pnpm with application-owned code and shared platform-independent contracts. Web remains Vue/Nuxt; its presentation and DOM utilities are not React Native building blocks. Mobile currently has no centralized theme or native screenshot goldens.

The user approved Expo SDK 57, iOS 16.4 as the new minimum, four navigation packages, WebView, PowerSync React Native, and OP-SQLite. Android remains API 26+. Other optional plugins require specific approval before adoption. Full feature and UI reproduction is the completion condition; native back appearance is the requested exception.

## Goals / Non-Goals

**Goals:**

- Keep React Native responsible for routes, application UI, domain coordination, and portable data/API logic; use narrow native interfaces for operating-system behavior and compatibility.
- Preserve the existing installation, on-device state, and wire protocols across a change of UI and synchronization SDK.
- Make feature, visual, native-build, and upgrade evidence explicit so partial screens or JavaScript bundling cannot be mistaken for completion.
- Give each optional integration an independent approval boundary while approved work proceeds.

**Non-Goals:**

- Redesigning the app, retaining the entire Compose UI inside an Expo shell, or introducing a separate browser-hosted mobile product.
- Moving Web or Extension presentation into React Native, expanding the API, or adding source-absent push, global search, general business deep links, or Android purchasing.
- Replacing repository deployment policy, deleting the source checkout, public App Store publication, Android release distribution, or operating production backend data as part of local implementation.

## Decisions

### 1. Application-owned Expo runtime with native builds

Create `apps/mobile` with TypeScript, Expo SDK 57, React Native, and explicit Android/iOS projects. Keep native modules, share targets, assets, configuration, tests, and development commands in this application. Custom native work requires development/release builds; Expo Go is not an acceptance target. Pin the compatible dependency versions against the SDK and registry at implementation time rather than copying unrelated Web versions.

Proposed internal boundaries are `src/navigation`, `src/screens`, `src/components`, `src/domain`, `src/data`, `src/platform`, `src/theme`, `assets`, and application-owned native modules. Screens consume domain state; platform interfaces hide OS details; the data layer owns one active account and synchronization lifetime. Do not create a shared UI package until another app actually consumes it. Import public `packages/contracts` exports and pure compatible utilities only. Avoid API runtime imports, Vue composables, browser storage, and DOM selection utilities.

Expose `pnpm mobile -- <command>` for local preparation, development, types, focused verification, and native builds. Mobile preparation must not make ordinary Web/API contributors require Xcode or start remote services. Verify Metro, pnpm symlinks, native autolinking, and a single installed React/React Native/native dependency version. Start with Expo's supported monorepo defaults; add resolver overrides only for observed failures. Checked-in native changes must survive the documented generation/update workflow without unreviewed overwrites.

**Alternatives:** A single managed configuration without native projects is insufficient for the standalone extension and legacy bridges. Embedding Compose would postpone the requested refactor and complicate duplicate navigation, state, and layout ownership.

### 2. Explicit dependency consent, with native fallback

The approved groups are:

| Group | Exact approved packages |
| --- | --- |
| Native navigation | `@react-navigation/native`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context` |
| Reading container | `react-native-webview` |
| Offline synchronization | `@powersync/react-native`, `@op-engineering/op-sqlite` |

Expo, React, and React Native are inherent to the selected runtime. Approval of an integration includes its required compatible transitive dependencies, not unrelated optional integrations. Record the approved group, resolved versions, and purpose in migration documentation. Before adopting another optional plugin, present its exact packages and capability to the user. A pending request cannot be satisfied by silently adopting a different package.

Use built-in React Native APIs where sufficient. Candidate groups for later decisions include provider authentication, StoreKit, Firebase analytics/crash reporting, files/clipboard/haptics/localization/network/secure storage, image gestures, and development-client tooling. Their presence in this design is not approval to install or configure them. Existing native provider/StoreKit/share/telemetry integrations can be ported behind local interfaces. If an approved plugin cannot reproduce a required capability, extend it through project-owned native code or use a native adapter for that capability.

**Alternatives:** Choosing every familiar Expo plugin at scaffold time violates the requested approval boundary. Pure JavaScript replacements for OS credentials, StoreKit, or an independent iOS extension cannot provide the source behavior.

### 3. Native stack owns routed navigation; overlays retain source rules

Use the approved React Navigation native stack with the genuine platform header/back control. Configure title visibility, backgrounds, insets, and surrounding article controls to preserve content placement. Replacing the entire header with a React component would defeat the native-back requirement. Scope the visual exception to the system back control and its necessary native treatment; do not exempt the whole article header.

Represent the nine source routes and preserve their subflows. Library feed/filter/scroll state belongs to persistent route/domain state, not a remounting detail component. Authentication success, sign-out, and account deletion reset the account root. Existing Google callbacks and incoming-share completion must not become replayable back entries.

Centralize back arbitration for selection, image viewers, sheets, drawer/dialogs, and unsaved comment input. Resolve transient state and discard confirmation before allowing a route removal, including header back and system gestures. Android hardware/gesture/predictive-back behavior is verified on supported OS versions; iOS swipe-pop cancellation is verified separately from a committed exit. Flush positions and release reader resources only at committed exit, while backgrounding still flushes pending position writes.

**Alternatives:** A JavaScript arrow cannot satisfy native navigation. Disabling all system gestures to simplify cleanup would change the required experience. A route-level cleanup effect alone cannot reliably distinguish cancelled interactive navigation.

### 4. Preserve the reader document and bridge, then adapt native gaps

Migrate the current `public/embedded` HTML, CSS, and `webview-bridge.js` as application-owned assets with pinned source hashes. Preserve DOM Range selection, cross-node paths/offsets, contextual matching, marks, YouTube IFrame interaction, image events, and outline anchors. The native/JavaScript bridge gets typed messages and lifecycle ownership while remaining compatible with existing annotation data. Do not reinterpret legacy path strings as a new serialization format without compatibility fixtures.

React Native implements the article shell, tags, tools, comment/reply panels, AI panels, RSS shell, and fullscreen image presentation. WebView renders the source document. Scope styles so shell tokens do not alter document content. Reuse document behavior instead of rewriting rich content as React Native paragraphs.

The approved WebView alone does not establish equivalence. Source iOS customizations suppress the stock selection menu, track selection-menu coordinates, toggle `scrollsToTop`, and serve cached resources through `WKURLSchemeHandler` for `slaxstatic(s)`. Android uses request interception and a different scrolling model. Implement app-owned extensions/adapters for gaps, with native build integration that does not depend on manually editing installed packages. Preserve streaming cancellation, origin fallback, and bridge listener teardown.

Android currently scrolls an outer Compose column containing a measured WebView; iOS scrolls WKWebView with a translated overlay header. Normalize stored positions and event coordinates through a platform adapter based on actual header/safe-area offsets. Verify selection menus and restoration using the original platform as baseline; applying a single raw offset to both is unsafe. Keep immediate exit/background persistence in addition to the source debounce.

**Alternatives:** Pure React Native text cannot reproduce arbitrary DOM selection, embedded content, and historical ranges at this scope. A remote Web page would weaken offline behavior and entangle the mobile UI with Web release timing.

### 5. One synchronization owner and a recoverable upgrade barrier

Use the approved React Native PowerSync/OP-SQLite stack for the new data layer, retaining the source schema, schema/protocol parameters, credential refresh, metadata diffs, and transaction upload behavior. Preserve transaction boundaries when forming ordered batches, the source pacing, isolated HTTP 400 rejection handling, and retries for other failures. Derive exact batch semantics from source tests/fixtures; do not assume that a count of operations equals a count of transactions.

Before any database owner opens the legacy file, locate `powersync.db` in actual old Android/iOS installations and verify both SDKs' supported on-disk compatibility, including the pending CRUD queue. A filename match is insufficient. Never delete/recreate a database to bypass this check or hand-edit synchronization internals. The upgrade coordinator exclusively owns the migration barrier and opens only one synchronization implementation for a given file.

If supported direct adoption passes fixture tests, open the existing file through the new owner after the barrier. Otherwise use a supported lossless export/import path, or retain a narrow legacy native data adapter as exclusive owner while pending operations remain. That fallback must serve reads/writes offline and synchronize in source order; cut over only after a verified checkpoint. A legacy data adapter is a compatibility component, not a retained Compose UI. New writes must not be split across two competing queues. No final implementation may claim upgrade support without proving its chosen path under interruption and offline pending writes.

Migrate DataStore protobuf `user.preferences_pb` through an app-owned native reader: Android `filesDir`, iOS `group.app.slax.reader`. Preserve session/refresh credentials, language, cache settings, environment, analytics identity, and continue-reading context. Keep a versioned, idempotent migration journal and recoverable original state in the private container. Use atomic replacement and checkpointing; never expose token values in host logs or diagnostic fixtures. Main app and extension need a compatible shared-authentication writer/read contract during the transition.

Retain the source cache layout or migrate it with verified mappings: `bookmark/<key>/content.html`, URL-MD5 image names, owner-aware collection keys, and the complete JSON in `ps_data_local__local_bookmark_info.data`. This JSON includes fields beyond the declared columns: positions, mark profiles, and manual/automatic cache state. Cached AI results and image-download/cache-limit semantics also survive. Cache cleanup is distinct from business queue cleanup.

Preserve persisted authenticated rendering with guarded refresh; clear an unauthorized session only if the failing response still matches the stored token. Clear/disconnect the former account before rendering another account. Sharing and analytics must use the matching account/environment.

**Alternatives:** A fresh database plus a network download loses pending offline work and local-only metadata. Moving preferences to a new storage package without an explicit reader loses the current session. Running both SDKs on one file invites queue and locking conflicts.

### 6. Port source platform integrations without changing their flows

Keep Android `com.slax.reader`, iOS `app.slax.reader`, share extension `app.slax.reader.share`, and App Group `group.app.slax.reader`, along with required provider callbacks and entitlements. Controlled upgrade builds use compatible signing and increasing versions; signing secrets remain operator-managed and are never copied into the repository.

Port the standalone iOS share target so it receives Safari preprocessing and other URL input, uses shared auth, collects through the API, and shows loading/success/error/cancel in its existing 180-point panel while the main app is closed. Retain Android text/plain share handling and subject/title semantics. Preserve outbound iOS activity-sheet image/title metadata and the source Android text behavior. A plugin that opens the main app for all incoming iOS shares cannot replace the independent extension.

Keep provider token/backend semantics: Android Credential Manager and iOS Google sign-in obtain the existing ID token payload; iOS Apple supplies authorization code and ID token. Provider UI/cancellation and agreements stay intact. Port StoreKit 2 product lookup, signed offers, order UUID/appAccountToken association, JWS verification, pending/cancel states, transaction listener, entitlement/revocation, and existing restore integration. Keep the authenticated `/subscription/inapp-purchase` WebView bridge and cookie lifecycle. Android's native purchase implementation is currently absent; do not fabricate a working purchase flow.

Port Firebase manual screen reporting/analytics/crash reporting and first-party events, including the stable device ID and source automatic-screen-reporting setting. Verify native crash reporting in a suitable release build. Include environment switching/restart, shake behavior where implemented, network checks, feedback context, cache cleanup, and hidden About/debug entry.

**Alternatives:** OAuth browser-only replacements or a different share extension UI would change the product. A generic IAP wrapper is acceptable only after approval and proof that its signed-offer and backend-validation semantics match the source.

### 7. Source-derived visual profile and a complete coverage ledger

Add the Mobile profile to `DESIGN.md` and keep executable values in `apps/mobile`. Preserve the source mobile shell `#F5F5F3`, reader `#FCFCFC`, action `#16B998`, local component metrics, and distinct RSS treatment; do not apply Web tokens. Copy original raster artwork at original logical display sizes. Preserve vector geometry through deterministic conversion or native resources; a new SVG/icon package needs approval. Record source path, hash, transformation, license/notices, and brand category.

The source does not ship fonts despite naming a reader serif family. Establish actual fonts, wrapping, weight, and line height from source native renders rather than assuming CSS family availability. Match Android and iOS independently. Preserve existing localization, test semantics as `testID`s, touch targets, keyboard behavior, and accessibility names/scaling.

Maintain a feature/state ledger with source evidence, target implementation, native test coverage, and render comparison status. The ledger includes at least:

| Surface | State and interaction coverage |
| --- | --- |
| Login | Agreements/terms/privacy, both source providers, pending action, loading/cancel/error, root reset |
| Library and drawer | Inbox/starred/archive as source-ordered flat lists without date headers, sync/avatar states, add URL/clipboard validation, pending parsing, star/archive swipe, context menu/title editing/direct menu deletion, continue reading, subscription promotion/logout |
| Collections | Feed selector, owner/shared avatars, unread/read state, empty/loading/errors, closed/expired feed, ownership restrictions |
| RSS/Labs | Settings toggle/error, subscriptions/add/rename/remove, all/per-feed list, refresh/poll/rate limit, history/end/retry, saved-state updates, full/summary/truncated reader, original link and images |
| Article | Skeleton, header/tags, tools/scroll, selection/marks, threads/replies/discard/keyboard/limit, title/actions/cache/share, ownership, gallery/zoom, YouTube/transcript |
| AI/outline | Streaming/cached/offline/error, key takeaways, summary, Pro gate, collapsed/expanded/hidden states, anchors and panel restoration |
| Settings/deletion | Every cache choice, images, language, remote notice with actual bottom gating, confirmation/denials/error/success |
| Subscription | Authenticated page, products/offers, purchase/verification lock, cancel/pending/error/success, existing entitlement lifecycle |
| Feedback/About/debug | Context, validation/follow-up/submitting/retry/success, five-tap entry, diagnostics, environment and cache actions |
| Platform flows | Independent iOS share/Android share, callbacks, native back/swipe cancellation/system gestures, background flush, upgrade |

Pin non-secret deterministic fixtures and capture old/new native renders on matched OS/device/locale/font scale/appearance/safe areas. Compare settled screenshots plus relevant motion, keyboard, selection, and scrolling interactions. Review overlays for text wrapping, geometry, optical asset placement, and colors. Exclusions are narrow and documented for system dynamic content and native-back treatment. No missing screen or whole header can be excluded. If a render is unavailable, its status stays incomplete.

**Alternatives:** Source style inspection or Expo browser previews cannot prove one-to-one native reproduction. Migrating only the nine route names omits much of the actual product.

### 8. Preserve shared-root release behavior

Add mobile-specific checks/build workflows with appropriate native runners and path selection. Maintain the existing API release contract: changes confined to mobile source do not qualify as API source deployment, while root manifests/lockfile/workspace or shared contracts retain existing release eligibility. Do not narrow those triggers in this change or overlap another change's API release delta.

Document local preparation, offline checks, native execution, and release operations separately through the root mobile command. Keep store credentials and publication outside automatic local setup and CI. The user explicitly authorized TestFlight preview `1.0.25 (759)` after uploaded preview `758`, without waiting for full migration or Firebase acceptance; those requirements remain pending for complete delivery. Use the existing publisher identity and opaque Xcode/Keychain authentication without reading, printing or copying credentials/private keys. Preserve main/share identities, App Group and matching versions; record archive/export/upload results and Apple processing status. Android development verification remains required; an Android release package is not part of this delivery. CI must report actual checks; unavailable signed/device tests remain explicitly pending.

**Alternatives:** Excluding every mobile-related root lock change from API checks would conflict with current repository release requirements. Making all repository setup unconditionally run native builds would burden unrelated contributors.

### 9. User-reported TestFlight stability and performance revision

After installing build 758, the user reported app termination on backgrounding, problematic list dragging, unnecessary opening loaders, broadly sluggish navigation/reading, and duplicate system selection actions. The user explicitly requested immediate fixes and prioritized performance and UI quality without waiting for a crash report. This authorizes removal of artificial readiness delays and avoidable loading transitions, not loss of content, offline writes, accessibility, native gestures, or account isolation.

Address persistent App Group lock ownership and finite background writes without unlocking a live competing database owner. Preserve migration checks while avoiding repeat migration-scale work for a verifiably accepted installation. Keep interactive gestures and scroll-following transforms on the native/UI execution path; React updates should represent semantic changes rather than every scroll offset. Separate outline content revision from position tracking and suppress equivalent repository/preference publications. Selection-menu control remains scoped to the Reader and must preserve handles and editor copy/paste.

Validate the five reported scenarios directly, with the uploaded archive and the current source identified separately. Host regression counts and a successful build do not establish physical iPhone suspension behavior or frame-rate parity. Use native execution and Release profiling where available, recording unavailable device evidence explicitly. The long-held file lock is a concrete defect candidate consistent with Apple's suspension rules, not a confirmed crash diagnosis without the termination report.

## Risks / Trade-offs

- [Old and new PowerSync storage may not be interchangeable] → Prove compatibility with queued-write fixtures before opening live files; keep exclusive legacy ownership behind the migration barrier if a supported lossless cutover is unavailable.
- [Dirty/untracked source can drift during migration] → Pin file hashes and source-render evidence; review deliberate baseline updates rather than silently mixing different source states.
- [Native headers change OS-specific appearance and insets] → Keep the exception narrow and compare surrounding content on each platform; test cancelled interactive transitions.
- [WebView defaults lack source selection/resource behavior] → Add local native adapters and exercise long mixed-content articles, historical marks, cancellation, offline images, and coordinate restoration.
- [Optional plugin approval may arrive later or be declined] → Keep adapters independent and continue approved work; use source native integrations when necessary without lowering feature coverage.
- [Rendering and text metrics differ across UI runtimes] → Use actual native source/target fixtures and resolve differences before claiming UI completion.
- [The current machine's iOS simulator service was unavailable during inventory] → Repair/verify runtime availability before capture; do not substitute browser renders or mark iOS acceptance complete.
- [App Group and upgrade signing configuration can break existing installations] → Validate identities/entitlements and controlled same-signature upgrades with operator-managed signing; do not publish a store build as a test.
- [SDK 57 raises the iOS floor] → The user approved iOS 16.4; document device support and preserve Android API 26.
- [Root dependency changes can qualify for API release] → Preserve existing policy and document coupling; review resulting CI scope before pushing.

## Migration Plan

1. Obtain human review of this proposal. Record approved integrations and source provenance; capture the source fixture/state ledger without mutating its checkout or reading secret files.
2. Establish Expo/native build entry points, genuine native navigation, Mobile tokens/assets, and platform/data interfaces. Verify monorepo dependency/autolinking behavior and both native launch paths.
3. Implement and prove legacy preference/database/cache compatibility before exposing a destructive initialization path. Exercise interruption, offline queue retention, account switching, and same-identity upgrades.
4. Port all library, collection, RSS, reader, settings, subscription, authentication, share, telemetry, and auxiliary flows. Intermediate stages are allowed for development; they do not satisfy final parity.
5. Run focused data/bridge/navigation tests and platform integration scenarios. Capture old/new native fixtures for the complete coverage ledger; resolve visual differences or obtain explicit user acceptance for specific differences.
6. Complete both native development builds, final iOS Release/archive validation, upgrade evidence, CI, and English setup/migration documentation for full acceptance. Perform the repository's required pre-push review and open the task PR targeting `dev`. The user's later instruction separately authorizes signed preview `1.0.25 (759)` and Git delivery before all acceptance is complete, retaining the unfinished checks and telemetry limitations. Record Apple upload and processing status; do not treat a simulator artifact or upload request alone as TestFlight availability. Public App Store publication and production backend actions remain outside this delivery.
7. Archive the change only after merge through the repository workflow.

For an interrupted local migration, resume from the journal and retain the recoverable original state. Before a cutover is finalized, the compatibility adapter can remain the exclusive data owner. App-level downgrade is not promised after new writes or database-format changes: restoring a stale snapshot could lose operations. Any release rollback requires a reviewed recovery strategy against the actual supported file format and pending-write state; do not erase user data to make an older binary start. The source checkout remains intact throughout.
