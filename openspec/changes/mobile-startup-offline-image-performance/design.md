# Design

## Context

See `proposal.md` for motivation and `specs/mobile-performance-lifecycle/spec.md` for the behavior contract. This worktree starts at `origin/dev` commit `4ac85a3e54e353f5b95c2ad9406d2d81d4c33ab4`; the main checkout remains unchanged. The comparison KMP directory is a production working tree over `9951904`, not a pristine release checkout, and is read-only.

The relevant baseline is Expo 57.0.27, React Native 0.86.3, Reanimated 4.5.1, Gesture Handler 2.32, PowerSync 2.3.1 and OP-SQLite 18.2.5. Existing Node/TypeScript, React mounted-host, real-browser PDF and Kotlin/Swift resource harnesses are available. `expo-image` is not installed; it is the one additional integration explicitly discussed and included in the user's implementation request.

Important observed constraints:

- `runtime.ts` restores local identity before storage admission, but Android ownership currently recursively inventories the sandbox and lacks the accepted-schema fast path already modeled in `adoption.ts`.
- Background caching watches complete local JSON, uses a single body-plus-images job per article, and retains that job's capacity through sequential images. Foreground HTML and several image consumers have separate acquisition paths.
- App-owned image APIs return Base64 to JS; automatic images use whole-body `arrayBuffer`; cache writes, directory traversal and deletion include synchronous operations. iOS resource network delegates also perform disk work on the main queue.
- PDF range logic safely validates responses but consumes the full body repeatedly when a server ignores Range. PDF resources are statically imported through the HTML reader route.
- Gallery gestures run in JS and ordinary paging changes the source only after release. Comments render all threads in a ScrollView, and high-frequency state is owned by the ReaderScreen hook tree.
- Existing migration requirements and `performance-pipeline.test.mjs` expressly prohibit a fixed 250ms mount barrier. Removing KMP's fixed delay was an intentional earlier decision, not a regression to restore blindly.

## Goals / Non-Goals

**Goals:**

- Keep ordinary initialized startup independent of historical content volume except actual necessary database open/query work.
- Make foreground reading and offline-body progress independent of slow optional images and background maintenance.
- Preserve one authoritative, owner-scoped durable resource store while reusing a native image display library.
- Establish observable lifecycle/task boundaries with deterministic behavior tests and real native performance evidence.

**Non-Goals:**

- No bypass of first-adoption verification, current access denial, authentication, signing, or PDF integrity checks.
- No new OS background transfer engine, synchronized server schema/API change, extra gallery framework or replacement native stack.
- No fixed artificial startup/reader delay, blanket freeze of security work, or unbounded prefetch/decode.
- No claim that every KMP path was optimal or that dependency choice alone proves improved performance.

## Decisions

### 1. Use an installation binding, not authenticated state, for startup routing

Add a versioned initialization/binding policy in the data layer. Its durable record identifies the current storage mode (native-created or legacy-adopted), canonical relative database slot, logical application/container owner, accepted compatibility profile/schema and initialization phase. Login and sign-out do not delete this record. Original preference migration and adoption journals remain available for recovery and backward-record upgrade.

Native ownership acquisition accepts a validated known binding. Both platforms acquire their existing ownership protection, resolve the allowed slot under the current legitimate root, reject symlink/owner mismatches, and perform a bounded schema identity inspection. A valid initialized installation performs no recursive discovery or complete row digest. Android gains its missing accepted-schema inspector. Fresh first initialization and incomplete/untrusted records retain complete discovery and adoption checks; missing established files are recovery, not permission to create an empty replacement. iOS container relocation is resolved through the existing logical identity rather than absolute-path equality alone.

Alternative rejected: using `authenticated` to skip admission. KMP preference import can create authenticated presentation before first database adoption, and signed-out installations still need data isolation. Also rejected: retaining full inspection on every relaunch or deleting old journals to speed startup.

### 2. Separate startup milestones and minimize repeated reads

Use a captured, revision-bearing native preference snapshot for the environment/local-identity bootstrap. Migration writes and cross-process changes invalidate or replace that snapshot through existing CAS semantics; request-time credentials continue checking scope and revision. Avoid a generic permanent preferences cache that could miss share-extension updates.

Publish local presentation first, admitted repositories second, and explicitly start lower-priority warmup after initial visible data work has been scheduled. Protected network readiness stays independent. Share one account/origin-scoped Labs service between Library/RSS/PDF consumers. Separate pending-transaction listening/recovery from product catalogue fetch, and make authenticated Web cookie preparation consumer-driven. Avoid redundant ready-state emissions and split stable service context from volatile snapshots.

Use lazy screen/module boundaries for optional routes and PDF initialization. Native release still ships the assets; this is lazy evaluation and bounded preparation, not an unsupported OTA code-loading scheme. Prewarm likely next interactions only after useful presentation and with lifecycle cancellation.

Alternative rejected: a global Promise.all barrier, arbitrary startup sleeps, or fetching every optional feature in parallel at process launch.

### 3. Introduce a small task scheduler with shared ownership

Extract scheduling policy from `BackgroundArticleCache` rather than growing the existing class. Separate task identity, execution lane, consumer leases, resource inventory, retry policy and maintenance.

Task keys include environment, account/runtime generation, access context, resource kind and version. Immutable PDF document identity is part of range/full-file keys. Image fetch sharing additionally includes the effective security/transport policy; identical URL strings alone do not justify crossing owners. Compatible current consumers share a native resource lease and receive the same committed URI; cross-bookmark sharing must preserve each bookmark's retention/eviction references.

Use a finite global network budget, per-host limits, a reserved foreground lane and bounded queued/backpressured work. Retain the existing overall concurrency envelope initially rather than increasing it speculatively. Separate body and optional-image capacity; manual/foreground work is promoted, automatic work receives aging/fairness. Cancelling a consumer detaches that consumer; the transfer cancels only when no durable/active owner still requires it or its account/version is revoked.

Persist compact local task/resource state: schema version, resource identity, body-ready state, pending/successful image set, attempt count, retry deadline and classified error. Store it in app-owned local-only metadata, outside synchronized business CRUD. Maintain existing `is_downloaded` compatibility as readable-body status while image completion stays internal. Discover legacy cached resources lazily during use/planning without a startup-wide filesystem sweep.

Alternative rejected: simply increasing the current per-domain concurrency, a second gallery-only downloader, or marking missing images permanently finished because HTML succeeded.

### 4. Make retry and maintenance policies explicit

One task layer owns scheduling retries; transport retries remain bounded and must not multiply a task retry storm. Inject clock, connectivity and scheduling boundaries for deterministic tests. Persist next retry and attempts; suspend on known offline state, use bounded exponential backoff with jitter for transient failures, honor valid Retry-After and stop on definitive access/identity rejection. Foreground requests can request an explicit retry without erasing denial/owner checks.

Replace full local JSON watches with projected cache fields and equality checks. Maintain an incremental desired set instead of reconstructing unrelated data on reading-position writes. Perform local field updates using SQLite JSON operations that preserve unknown keys and existing string/number/null representation.

Eviction has a durable intent/generation and two short metadata commits surrounding asynchronous file work. It rechecks pins, consumers and scope immediately before deletion/commit. No filesystem operation remains inside a long business write transaction. Recovery reconciles unfinished intents without deleting a newly acquired resource.

Alternative rejected: timers tied to React screens, retries triggered by arbitrary watcher updates, or moving deletion outside its transaction without adding race/recovery protection.

### 5. Provide asynchronous native file/resource ports

Introduce focused application-owned native storage/resource operations exposed through typed adapters. Move large file writes, inventory measurements and deletion to bounded native worker queues. New resource files use temporary paths and atomic publication after identity, access, MIME/length and cancellation checks. JS receives metadata and a controlled URI rather than the entire image byte body or Base64.

Unify automatic image caching, HTML resource interception, gallery and sharing under the same guarded resource identity and acquisition coordinator. Android resource reads remain off the UI thread; iOS uses a serial/state-protected resource worker for disk/network bookkeeping, delivering only required WK callbacks on main with ordered bounded chunks. Do not synchronously wait on main while holding a lock needed by main-thread revocation. Account changes cancel jobs and prevent any late final-path commit.

The native resource service preserves credentialless image transport, signed proxy allowlisting, redirect-by-redirect checks, controlled fixture scopes and original cache path compatibility. It is not replaced by arbitrary direct remote URLs in `expo-image`.

Alternative rejected: wrapping sync File methods in Promise.resolve, native-to-JS Base64 roundtrips, patching dependencies, or a background URLSession replacement that drops redirect policy.

### 6. Optimize PDF behind existing contracts

The user's apply instruction explicitly makes PDF automatic acquisition equivalent to ordinary articles and removes the standalone offline-download action. Keep automatic full-document completion and range promotion inside the shared scheduler; retain compatible existing retention metadata without requiring a user button. Remove the toolbar action, its busy UI state and obsolete screen command plumbing, and update the older migration wording to reflect this explicit refinement rather than retaining two contradictory UI requirements. Existing PDFs remain eligible independent of the import Labs setting.

Known offline connectivity plus a valid admitted, non-revoked descriptor can use local metadata without exhausting a network deadline. Online/revalidation and definitive denial semantics remain explicit; stale cached metadata must not override observed 401/403/404/412 denial or descriptor identity change.

Promote PDF transport to a discriminated result representing validated range bytes or a single shared full-body acquisition. If the server ignores Range, stream once to a bounded staging file, populate versioned blocks, and let overlapping waiters reuse it. Keep optional ETag checks, total-size/length checks and complete-file SHA-256 before offline-complete publication. Do not add endpoints.

Make PDF resource module evaluation lazy. Keep the current bundled matching viewer/worker/assets first; alter the physical resource delivery layout only if needed and with CSP/local-resource checks. Retain six-page residency, canvas pixel limits, actual native host viewport, chunk backpressure and annotation coordinates.

Alternative rejected: downloading whole PDFs independently per range, trusting a cache flag without identity, or replacing the established native scroll contract.

### 7. Compose image display and gestures instead of inventing another decoder

Add SDK-compatible `expo-image` (currently `~57.0.5`) through pnpm/Expo tooling. Build:

- `AppImage`: stable identity, safe source, placeholder/error policy, content fit, decoding bounds and short source transition.
- `ZoomableImage`: measured focal pinch, pan constraints, double-tap and interrupted animation on the Reanimated UI runtime.
- `ImageGallery`: continuous page movement/settling, gesture arbitration and a bounded current-plus-neighbor preparation window.

Use the installed Gesture Handler/Reanimated stack. Keep resource resolution separate from UI transforms. Expo memory/disk caches accelerate display; durable offline resources remain app-owned. Do not duplicate every local file into an additional persistent image cache. Release old image references and stop hidden animated playback; do not decode every original at maximum dimensions. For source/account replacement, identity is checked before paint and before accepting decode callbacks.

Adopt reusable remote image presentation for avatars and RSS where it preserves current behavior. Bundled icons and HTML DOM images are not mechanically replaced. Sharing consumes the same resource URI.

Alternative rejected: treating Expo Image source transition as a gesture pager, a new third-party gallery library, or relying on purgeable display caches for promised offline availability.

Post-delivery review corrections (no new dependencies): the gallery strip is an absolute UI-runtime position (`page × width`) settled with a velocity-carrying, overshoot-clamped spring; JS commits are idempotent page numbers, so a commit arriving late can neither be rejected nor snap the strip back. Every mounted page can begin a swipe, while pinch/double-tap remain limited to the resting active page. Thumbnails at or below 512×512 px use Expo's native memory cache and downscaling instead of the shared two-slot decoder; fullscreen pages keep explicit capped decoding, the visible page is admitted ahead of queued neighbours, and decoded pages leaving the current±1 window are retained under a 40 MiB gallery-scoped budget that is released when the gallery closes.

### 8. Isolate actual rendering work and visible lifecycle

Introduce explicit feature stores/props where high-frequency state changes occur. Draft state belongs to the editor interaction owner; AI presentation subscribes to its own bounded stream updates; the article/PDF host receives only document/geometry/annotation changes and remains stable. Memoization is applied after stabilizing inputs, not as a substitute for ownership.

Flatten visible comment threads into stable-key virtualized rows while preserving parent/reply context, menu geometry, permissions, input limit, keyboard and discard behavior. Streamed Markdown updates only changed content blocks or a coalesced stable render window and never reparses on position-only changes. Preserve links, selected text and scroll context.

Route visibility and App foreground are distinct inputs. Hidden optional work is paused/coalesced, while account revocation, writes and required recovery continue. Navigation cancellation never commits exit or destroys the document. Content already ready is not delayed by an unconditional animation timer; nonessential preparation and cold heavy presentation are coordinated with real transition state and safely interrupted.

Replace SourceSheet's JS continuous drag with UI gestures. Restore the intended row long-press spring/shadow. Centralize reduced-motion/interrupt/completion handling for menus, comment surfaces, floating actions and gallery. Local star/archive mutations can start immediately; native modal/browser/share presentation still waits for actual dismissal completion.

Alternative rejected: moving all Reader state into another large hook, blindly freezing every offscreen route, or restoring KMP's fixed 250ms wait against the current contract.

Post-delivery review corrections: HTML article scroll metrics are sampled during user drag/fling (iOS native 50 ms with trailing and end/settle emissions; Android outer scroller 48 ms plus drag/momentum end), while native overlays still follow every frame and PDF virtualization and programmatic scrolls stay per frame. The memoized HTML host receives identity-stable header/footer elements and live-only callbacks; its final position flush stays memoized on its account/document inputs so a retired document keeps its own fence. PDF host callbacks intentionally remain per-render closures because each captures the host lease that rejects retired callbacks. After restore, Android content-size growth no longer rerenders the page. iOS persists the compiled content-rule list under a build- and content-derived name and removes only previous builds' lists, so cold launches reuse the same security policy without recompiling it.

### 9. Validate structural invariants and the actual native deliverable

Extend existing tests, not a new test framework. Important deterministic assertions include zero full-inventory calls for valid initialized relaunch, no duplicate transfer for overlapping consumers, no replan on position-only updates, body progress despite stalled images, atomic incomplete-write rejection and no stale-source paint. Exercise real Kotlin/Swift file/resource code and browser PDF runtime in addition to mounted JS host tests.

Measure Release on matched available targets with the same data/cache conditions: first interactive surface, admitted first local list, cached article readiness, long-frame distribution/input delay during downloads, download bytes/completion, and decoded-image memory. Record before/after raw measurements and representative large libraries; do not invent universal millisecond/FPS claims without devices. Existing fixture apps are development builds and cannot alone establish Release performance.

Run final standard commands on the actual versioned code: `pnpm mobile -- check`, `pnpm mobile -- bundle`, affected native/resource commands, relevant tooling checks, strict OpenSpec validation and `git diff --check`. Required unavailable evidence stays incomplete. Pre-push Bugs/Security/Compliance review is performed by the primary agent, without subagents.

## Risks / Trade-offs

- [Accepted binding wrongly trusts missing/replaced storage] -> Validate native logical owner/slot/schema, preserve legacy journals, reject ambiguous established state and test container relocation plus sign-out interruption.
- [New scheduler loses manual retention or pending CRUD] -> Additive local state, owner-aware leases, reference-safe eviction and actual SQLite lifecycle tests; never rewrite the synchronized schema.
- [Worker/main callback deadlock or stale commit] -> Explicit queue ownership, bounded message delivery, no cross-queue lock cycles and native cancellation tests.
- [Local-first PDF violates access policy] -> Only admitted non-revoked offline scopes use it; online denial remains fail-closed and identity/hash checks stay mandatory.
- [Image abstraction increases decoded memory] -> Per-surface dimensions, bounded neighbors, release old refs and profile native memory; persistent files are not duplicated gratuitously.
- [Lazy modules worsen first interaction] -> Prepare likely routes only after useful presentation and compare both startup and first-open timing.
- [Legacy scope overlaps an active change] -> This change owns only `mobile-performance-lifecycle`; preserve migration requirements, do not duplicate capability deltas or check off old tasks. Stop and sequence any later conflicting implementation.
- [Worktree lacks operator inputs or native dependencies] -> Use supported absolute configuration paths/existing loader without reading/copying secrets. Missing access blocks publication, never authorizes a fake config or unsigned substitution.
- [Cleanup deletes recovery or symbolication data] -> Record exact task-owned paths; retain receipts, required dSYMs and public evidence before deletion; never delete global tool caches.

## Migration Plan

1. Prepare the independent latest-dev worktree and this proposal; obtain the required subsequent apply instruction before editing product code.
2. Capture baseline check results and task-owned output paths, then implement/test startup, task/storage, PDF, images and reader work in dependency order.
3. Upgrade initialization records and resource inventories additively. Preserve first-adoption/full-recovery behavior and unknown local data; do not delete old state as an optimization.
4. Regenerate native projects through owned plugins, compile Android/iOS, run original scenarios and record Release comparison. Update accurate compatibility docs and generated guidance sources where the documented behavior changes.
5. Determine the last published build bound at release time, increment package build metadata, regenerate and revalidate. Current tracked version is 1.0.25(766), not a guarantee that 766 will remain the latest when publishing.
6. Use guarded production-only archive/export/upload commands from `docs/mobile/release.md` with the existing publisher account and original main/share identities. Preserve main Firebase and dependency-closure checks. Report Apple acceptance, processing and tester availability separately.
7. Complete local pre-push review, commit/push the feature branch and create one PR targeting `dev` with `OpenSpec: mobile-startup-offline-image-performance`. No merge, backend deployment or public store publication.
8. Deliver public validation/upload/PR evidence, then remove only task-owned obsolete build products, DerivedData and disposable caches. If Apple processing, upload recovery or symbolication still needs an artifact, retain it and report why.

Rollback is source-level only until native/data validation completes. New local records must be versioned and backward-safe; do not downgrade the synchronization SDK or erase queues to roll back. A published binary rollback requires a separately versioned build, not rewriting an uploaded artifact.
