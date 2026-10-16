# Mobile reader compatibility

## Source and ownership

The reader is migrated from the working source snapshot at
`9951904405159f49f24effd4d42815f77ff33442` in `slax-reader-client`. The source checkout
is read-only. `apps/mobile/assets/embedded/source-manifest.json` records the exact
paths, byte counts and SHA-256 hashes of the imported template, CSS, JavaScript,
error page and image. These imported files are unchanged. The source Apache-2.0
license is retained as `SOURCE-LICENSE.txt`.

`react-native-host.js` is application-owned transport around the imported bridge.
It installs the original Android `NativeBridge`; iOS registers the real native
`NativeBridge` before WKWebView construction and forwards its source messages
through `receiveSourceMessage` into the same host normalization. The transport
adds page generations and command responses, measures content, and
releases listeners/player resources. It does not replace the article with native
paragraphs. `generate-assets.mjs` creates the deterministic TypeScript embedding
and checks both manifest integrity and generated freshness.

Bookmark image `src` attributes are rewritten from HTTP(S) to `slaxstatic(s)`
before the document is parsed, so initial image requests use the source cache
transports. The composer changes attributes without serializing or restructuring
nodes, and excludes comments and raw-text elements. The host also rewrites images
at DOM readiness. RSS feed previews keep their signed HTTPS image URLs. Remote
resource cache lookup and cancellation belong to the application-owned native
adapter.

## Application interfaces

`ReaderWebView` accepts the complete article HTML, cache key, source-compatible
mark detail, user ID, initial position, metadata info pack, measured header/footer
and callbacks. Its imperative handle exposes selection capture/clear, mark
redraw, outline anchors, YouTube seek/current-time, ordered image URLs, position flush and committed
exit. Commands are scoped to one page; stale pages and malformed messages cannot
update a replacement article. Dynamic mark updates do not restart the selection
monitor.

Controlled debug fixtures can inspect actual native scroll callbacks and bridge
load/message counters through `inspect-position`. The screen validates the
isolated scope marker before writing `reader-position.json`; ordinary readers
cannot use this operation. Requested fixture positions and observed native
positions are recorded separately. Early iOS inset scroll callbacks update the
visible header transform while saved-position writes remain fenced until initial
restoration is consumed. These diagnostics and React lifecycle regressions do
not establish native gesture or visual acceptance.

Outbound sharing uses the application-owned native `shareArticle` interface.
iOS tries exactly the first two article image candidates, reuses the namespaced
cache, and accepts an image only when both dimensions exceed 100 pixels. It falls
back to the source `share_logo` asset. Metro HTTP assets are cached with the
already approved Expo file API before passing a file URL to native code. Android
retains the source text and subject chooser. Share-sheet preview behavior remains
subject to native validation.

The source selection result uses `xpath`, `start_offset` and `end_offset`.
`packages/contracts/marks` also contains a request type with the legacy
`start_offet` spelling; it is not used as the WebView output type. Local annotation
storage uses `path`, `start` and `end` from `packages/contracts/interface`.
`selectionPaths` performs the explicit conversion. Approximate quote context and
the selected text/image payload are retained. Rendering can recover an invalid
historical path from its quote and context, without rewriting its persisted
source or changing the source group's identity.

`model.ts` retains Kotlin's UTF-16 `String.hashCode()` numeric bridge identity for
UUIDs. Numeric legacy IDs above JavaScript's safe integer range and detected
annotation ID collisions fail explicitly. Deleted comment ancestors remain in a
thread when an undeleted descendant needs them. Collection actions and profile
visibility follow the current collection policy; a missing owner cannot authorize
personal bookmark actions.

`ReaderScreen` binds the local repositories, cache, session, preferences and API.
It implements source header metadata/tags, overview and key takeaways, outline
streaming and anchored links, annotation actions and threaded comments, draft
discard protection, external link preference, toolbar actions, image gallery and
inline YouTube transcript commands. RSS remains a feed preview after saving and
updates all live feed caches through `reportRssSaved`; its header and long-page
footer retain the save actions, original link, source, author/date and truncation
notice. The normal article keeps the original template's bottom separator and
150 CSS-pixel reading space.

The iOS Reader keeps the genuine native back control in a transparent native
header so its WK viewport fills the window, as in the original overlay layout.
The React article header supplies status padding and the source 44-point
navigation spacer (52 points before RSS content). Native inset includes the
status padding, while the source header-visibility and near-bottom measurements
exclude it. The skeleton retains the source title, metadata and six body bars.
Mounted component regressions cover this separation; the new full-window native
render still requires a matched capture. The controlled original iOS run in
`evidence/2026-10-10-source-ios/source-native-launch.json` observed position zero
despite its saved 240-pixel fixture input. That original initial-callback timing
is recorded as a limitation and does not justify losing the target's saved
position restoration.

Tag assignment retains the source's draft workflow: adding or removing a chip
changes the draft until Confirm, while Cancel discards assignment changes. New
tag creation persists immediately, and later repository acknowledgements
reconcile the draft. Comment input retains the source's 1,500-character limit.
Changing article route parameters resets article, annotation, AI and overlay
state before binding the replacement article.

Outline link escaping and streamed-link buffering are ported from
`MarkdownHelper.kt`. The outline uses an application-owned Markdown-to-HTML
renderer in an approved WebView, with headings, links, lists, code, quotes and
tables. This renderer's typography and edge-case Markdown behavior still require
comparison with the source Compose Markdown renderer. It is not evidence of
visual parity.

## Native adapter boundary

`ReaderNativeAdapter` supports an optional `HostComponent` with the public
WebView ref/event shape. A custom view is needed because a new-architecture stock
WebView cannot obtain the source WK configuration and selection subclass simply
by attaching after creation. The native implementation must provide:

| Operation | Required source behavior |
| --- | --- |
| Construct the host | Install WK scheme handlers or Android interception before loading HTML; bind the page and namespaced cache key. |
| Selection | Suppress the system selection action menu while retaining arbitrary cross-paragraph DOM selection and native handles. |
| Touch coordinates | Emit logical screen points; divide Android physical pixels natively. |
| Scroll ownership | Android measures a full-height, non-scrolling WebView inside the outer reader scroller. iOS retains WK scrolling and content insets. |
| Insets | Preserve the adjusted offset when the measured header changes; support negative initial iOS offsets. |
| Status-bar tap | Set `scrollsToTop` for the reader and disable it while the comment panel owns scrolling. |
| Release | Cancel scheme/network streams, stop media and loading, remove page listeners and detach native ownership after a committed exit. |

A cancelled interactive native back gesture must retain the page and its pending
state. No teardown is attached to gesture start or `beforeRemove`. Page unmount
or an explicit committed exit disposes the bridge, flushes the newest reading
position, and releases native ownership. A generation-aware attachment rejects
late attach completions after release and prevents them from installing touch
subscriptions. The source back-button analytics event is pending a native header
click hook; gesture or hardware exits must not be mislabeled as that click.
Ordinary article navigation uses the native route stack. The approved
system back control replaces the source custom back overlay; other changes in
spacing and motion need comparison, rather than being assumed equivalent.

A reported WebView content-process crash is distinct from an HTML/network
failure. Retry first flushes the latest reading position and then remounts a new
native page generation. Concurrent retries share that operation, and a committed
exit prevents an unfinished retry from resurrecting the page. Ordinary fetch
failures retain the current native page.

## Position and cache formats

Legacy `read_position` and `outline_read_position` are physical pixels, stored as
strings in the full local-bookmark JSON row. React Native and DOM layout offsets
are logical points/CSS pixels. `coordinates.ts` keeps the conversion explicit:
Android positions are outer-scroller points times pixel ratio; iOS positions are
the raw WK offset plus the actual top inset, times pixel ratio. A saved iOS
position can restore to a negative raw offset. Header height, viewport height,
container screen origin and WebView screen origin remain separate inputs.

Initial restoration waits for the native attachment and serializes measured
insets before applying its offset. A pending restore is consumed once, and early
layout/inset callbacks do not overwrite the stored position. The actual mounted
Reader regression holds the native inset promise after DOM/load readiness, then
checks that the late attachment restores 240 physical pixels exactly once.
Native callbacks update the header's visual offset before persistence becomes
active, so an initial negative iOS inset leaves the article header visible.
The source more control beside the native back button follows the source
toolbar visibility with a -100 point, 300 ms animation. Its hidden state
disables touch and accessibility; the approved native back control remains
available. Near-bottom visibility uses the source inset-adjusted iOS offset
and 100 point threshold. Native motion and bounds still require capture.
The iOS restore uses the source document's `window.scrollTo` path through the
typed bridge after the inset fence. A direct `UIScrollView` offset command can
be reset by subsequent WK document layout. A controlled actual iOS run recorded
the requested 240 pixels as native offset -216 points plus 296 points of inset,
at scale 3. This confirms that restore case; it does not complete visual or
native gesture acceptance.

The controlled `inspect-position` action writes only inside the validated debug
fixture scope. It records the requested value, consumption flag, observed native
offset/content/viewport geometry, and load/message counts for the current page.
These diagnostics distinguish a missing bridge from a restoration failure;
they do not substitute for actual native input or matched source renders.

Position writes are serialized with the source two-second debounce and immediate
background/document-change/exit flush. A failed write remains retryable. The
continue-reading preference records title, bookmark and collection context on
background and clears on resume. Local JSON updates preserve unknown fields.
Collection content/images use `collection-<owner>-<bookmark>`; RSS uses
`rss-<entry>`.

Reader callbacks and persistence recheck the account and the resource owner
captured when the screen mounted, including preference CAS retries. A new login
for the same user cannot reactivate a departed reader. Account cleanup revokes repository and file
cache access so queued writes cannot repopulate cleared data. Share-image fetches
complete outside the account directory and recheck that lease before committing
their bytes; logout also prevents a delayed image result from reaching sharing.

Normal native reader views capture an immutable account resource owner before
loading. The owner must match the active native account, including for a React
mount that arrives after logout or after another account enters. Revocation
resets that owner and permanently closes existing resource handlers before
clearing files. Android serializes cache creation, chunk writes, and final
publication against this revocation. iOS task creation and URLSession callbacks
share the main queue. Safe source image filename extensions, including
`png-v2`, retain the same path rules as the TypeScript cache.

The optional production-Kotlin concurrency fixture uses small Android API stubs
on a host JVM. Supply already installed public Kotlin compiler/library jars in
`SLAX_KOTLIN_COMPILER_CLASSPATH` and `SLAX_KOTLIN_STDLIB`, and select Java 17 with
`JAVA_HOME`, then run `pnpm mobile -- test:native-resources`. It performs no
dependency fetch or real network access. Its completed/partial/delayed-response
cache, permanent-close, owner, and filename assertions are host execution
evidence; Android WebView and iOS WebKit acceptance still require device runs.

## Evidence and pending validation

The reader tests currently cover asset hashes, source-template integrity,
dangerous command strings, malformed/stale messages, disposal/timeouts,
cross-paragraph selection source offsets, historical marks and overlapping
threads, contextual recovery, source YouTube commands, source anchor suppression,
identity/privacy/deleted-thread rules, transcript decoding, streamed Markdown
links, position conversion and persistence failures, image transport parsing,
share candidate selection, and late native attachment disposal. A pure lifecycle
fixture demonstrates retained bridge requests and deferred position writes until
committed release; it cannot prove native interactive-back behavior. Additional
pure tests cover tag Confirm/Cancel drafts and repository reconciliation,
crash-only remounting, concurrent retry, and exit during recovery. The DOM fixtures execute the
imported bridge and template. The YouTube provider is faked, while the template's
actual player initialization and commands run unchanged.

The DOM suite reuses an existing Happy DOM runtime when available. Its anchor
fixture models the standard text `NodeIterator` cursor fields missing in Happy
DOM and bypasses source visibility checks using the source's `jsdom` branch. It
does not validate browser layout, native selection handles, scroll geometry or
real YouTube playback. A local headless Chrome attempt terminated before page
loading; it produced no accepted rendered-reader evidence.

The approved historical-annotation requirement also repairs one observable
legacy rendering gap: an annotation with an empty or obsolete node path can
render its saved exact contextual quote without changing its persisted source
identity. The shared mixed fixture includes an approximate-only annotation for
`Second paragraph with quote.`. The original native reader shows only the
separate path-based `Second` stroke; the migrated reader additionally renders
the complete saved quote. This is an explicit required legacy repair, rather
than a replacement of a node-path range with a whole paragraph. Its affected
pixels must be assessed separately from unchanged annotation ranges. The
mismatched whole native frame does not establish visual acceptance.

Controlled UI fixtures can prepare actual source DOM ranges, annotation taps,
image taps and existing reader commands through a development-only action port.
Annotation preparation resolves the persisted comment ID through the source
bridge's range group before touching its generated DOM UUID. Shared-fixture DOM
regressions verify that lookup, threaded replies, cross-paragraph selection and
image-click payloads for both platforms. Fixture RSS previews use cached custom
image schemes so prepared images cannot trigger an external request; production
RSS previews retain their signed HTTPS URLs.
The native cache scope requires its controlled-fixture marker, and fixture
documents reject external resources and navigation. Missing fixture image
resources cannot fall back to remote React Native images; external opening and
native sharing are also disabled. These commands prepare repeatable frames and
do not prove native selection gestures or touch delivery. YouTube events are not
fabricated: playback and transcript commands remain incomplete without a real
player or a separately documented local provider fixture.

Main development Android/iOS builds are recorded separately in the build
evidence. Required interaction checks are still pending:
device/simulator cross-paragraph selection, menu suppression, touch coordinate
calibration, old-app read-position restoration, in-place upgrade with pending
CRUD, image cache interception/offline failures, status-bar scrolling, real
YouTube playback and transcript seeks, gallery gestures, cancelled native back
gestures, sheet keyboard behavior, and the source/new screenshot comparison.
The source gallery is reimplemented with base React Native gestures; gesture and
animation parity cannot be inferred from TypeScript tests. Sharing must retain
the source iOS image preview and logo fallback on a real share sheet.

## Controlled input observations

The actual isolated iOS Alpha long press in
`evidence/2026-10-11-target-ios-reader-native-longpress/negative-alpha-report.json`
produced a noncollapsed five-character DOM range, but the App selection menu did
not appear. The original monitor processed that range; its actual
`webkit.messageHandlers.NativeBridge` was absent. That run remains a negative
result, including the disk-guard termination during incomplete xcresult
finalization. Earlier successful original-installation comment taps remain
separate evidence; the missing handler observation does not invalidate them.

The native correction registers `NativeBridge` alongside the existing
`slaxReader` envelope channel. Each native Reader accepts one immutable document;
replacement HTML or page identity requires the existing React ReaderPage
remount. The weak source handler checks main-frame origin, ownership, document
generation and page identity, then the host checks its active page again before
adding selection geometry, counters and the RN envelope. It does not create or
process a selection. The production navigation gate admits the initial main-frame
request once and checks the exact `WKNavigation` returned by `loadHTMLString`.
Later main-frame navigation is cancelled; an unexpected navigation callback or
server redirect invalidates the page. Normal subframes retain the source YouTube
behavior. The same pure Swift gate passes eight host cases without loading
WebKit; actual WK delegate order and registration remain pending. Dynamic-native-namespace and original SelectionMonitor DOM
regressions cover forwarding and stale-message rejection. This correction still
requires a new native compile and actual WK long-press retest.

The controlled Debug Reader observer can additionally record passive input
diagnostics. They contain finite touch/selection/source-message counts, monitor
flags, movement distances, closest-mark flags, and application parse/account
flags. Neither selected text nor annotation IDs, article content or credentials
are recorded. The document listeners only observe capture events; they never
dispatch touches, process a range, change selection or create a comment panel.
Strict parsing rejects unknown fields and invalid snapshots. Release and normal
Debug documents omit the listener registration, and a diagnostic message is
never forwarded to application actions. The original-installation harness uses
its separate gated observer and retains the normal product branch, without
`fixtureOnly` or document preparation commands. The isolated UI harness records
at most 128 events in its validated `reader-input.json` scope.

DOM regressions preserve the original distinction between a `click` and a
mark's `touchend`, its ten-pixel movement guard, and its pending-selection
behavior after `touchcancel`. Mounted React tests also verify that a failing
observer cannot interrupt delivery, restoration, persistence or detach, and
that Release ignores the observer. These checks do not prove native WK touch
delivery. Actual selection publication and old-comment taps remain unresolved
until the passive records are captured in a fresh controlled native run.

## Telemetry compatibility

`src/telemetry` preserves source Firebase event names and parameters, including
manual route views, bookmark actions, outline interactions, and the protected
`platform: app`, `platform_type`, and `version` fields. Analytics and Crashlytics
identity updates are independent. Automatic native screen reporting must remain
disabled in build configuration to avoid duplicating manual source events.

The first-party collector retains `analytics_device_id` from shared preferences,
sends the source `{events: [{event_name, occurred_at, properties}]}` payload to
`/events`, and uses the existing authenticated API transport and client/device
headers. Locale is read from the current runtime. Version uses `NAME (CODE)`.
Library first-party views belong to the selected list mode and must be reported
by the Library controller rather than the generic route hook. All collectors are
best effort and cannot block reader or authentication actions. Pure tests cover
persisted identity, event naming, route exclusions, exact payload shape, locale
changes, and independent sink failures; native Firebase delivery is not verified.

No source-vs-new reader UI, native upgrade, real-player or pixel/animation parity
result is declared passed by this document.

## Approved PDF extension

PDF is an approved addition to the same native `Reader` route, not part of the
historical HTML source-parity proof above. `ReaderScreen` resolves the repository
bookmark type before consulting the HTML cache or raw-content API. A record that
has not synchronized yet cannot accidentally start an HTML request. PDF keeps the
native title, tags, overview, tools, comments and back/discard handling, with a
bounded native header above an independently scrolling PDF viewport on both
platforms. It does not use the HTML reader's full-height Android outer scroller.

`src/reader/PdfWebView.tsx`, `pdf-document.ts` and `pdf-runtime.ts` own the PDF-only
document. `tooling/pdf-assets.mjs` bundles the pinned `pdfjs-dist` version with its
matching real module worker, CMaps, standard fonts and WASM resources. The worker
runs locally; a remote Web reader, Vue/Nuxt presentation, native PDF SDK or fake
worker is not the implementation. Bounded canvases and text layers support page
navigation, zoom, eviction and redraw. Authenticated URLs and bearer credentials
remain outside the WebView: `PDFDataRangeTransport` requests bytes through the
application boundary rather than fetching the private API itself.

### API, foreground queue and local files

The current compatibility target is the existing authenticated
`GET /v1/bookmark/metadata?bookmark_uid=...` response's nested `data.pdf` descriptor
and `/v1/bookmark/pdf` binary reads. The user explicitly requires no new backend
API. The introduced `/pdf_metadata` and conditional-response additions are removed,
not pending deployment. Authorized actual `SlaxApi` requests to
`https://reader-api.slax.dev` returned metadata 200 and twelve Range 206 responses
without ETag, totaling 2,924,012 bytes with the descriptor SHA-256 matched for a
41-page PDF. Mobile must use the configured API origin, accept absent ETag,
validate content type/range/actual length, and use any supplied ETag only as an
additional check. Full size and SHA-256 validation still gate offline-complete
status; a range response alone does not cryptographically verify an individual
block. The current bundled PDF.js rendered the first and last pages in headless
Chromium with one real module worker, zero page errors and no PDF toolbar; see
[the bounded live-contract evidence](evidence/2026-10-13-live-pdf-contract/verification.json).
This is not native Expo rendering, cold-start lifecycle or PowerSync acceptance;
those end-to-end checks remain pending.

PDF extends `BackgroundArticleCache`; it does not introduce a second scheduler.
Visible-reader requests join or promote deduplicated **256 KiB** block work in the
existing foreground queue. `PdfBlockCache` stores a versioned manifest containing
the descriptor and block size, with document identity and size separating block
sets. Native storage is scoped to environment, account and personal/collection
owner context. Atomic writes publish validated blocks; only complete size- and
SHA-256-verified bytes receive the available-offline state. Partial progress is
not offline completion. Revocation fences late reads/writes and online access
denial invalidates cached access; an offline shared copy cannot discover a new
server-side revocation until connectivity returns.

The production `PdfFileStorage` uses the native `SlaxCachePaths.pdfCacheFileUri`
guard before Expo file I/O. Android requires the supplied root to match canonical
`context.dataDir`, but returns physical files under canonical
`context.filesDir/pdf`, which Expo permits. Canonical comparison accepts Android's
legitimate `/data/user/0` to `/data/data` alias while still rejecting traversal,
non-app roots and symlinks in `files` or PDF path components. iOS retains its native
Application Support ownership boundary. Image paths and App Group behavior are
not broadened by the Android PDF path correction.

Backgrounding pauses/aborts network work while keeping valid blocks and retained
cache intent for foreground resume. Closing Reader releases its rendering and
request lifetime, but not an independently retained manual offline-download task.
There is no background URLSession, WorkManager or other OS background transfer
service. Native cache/file boundaries remain application-owned; cleanup cannot
remove comments or pending synchronization operations.

PDF Labs enables local acquisition. The project-owned `SlaxPdfImport` module uses
the native document picker, accepts one nonempty PDF up to 50 MiB, and copies it
into a private temporary import directory. iOS uses coordinated security-scoped
access; Android reads the selected content URI. Both bound the copy, validate the
PDF signature and constrain deletion to their own temporary files rather than
accepting arbitrary filesystem paths. The application uploads the raw PDF through
`/v1/bookmark/upload_pdf`, rechecks Labs/account ownership, cancels upload on
background, and waits for the synchronized bookmark before opening Reader.
Cancellation and upload errors do not report success. Uploads display the filename
and local-upload source, not a synthetic original URL. PDF URL saves retain normal
capture; disabling Labs does not remove access to existing PDF bookmarks.

### Positions, annotations and extracted text

PDF position is stored separately as `pdf_read_position` JSON containing
`document_id` and a one-based page plus fractional page offset. It never reuses
HTML physical-pixel `read_position`; outline position remains independent.

The existing selection/mark model retains PDF version, immutable document ID,
one-based page, exact selected text and unscaled quadrilaterals. Native highlight,
comment and reply actions use existing mark repositories and PowerSync writes,
including collection permissions and stroke-only deletion. Selection geometry is
translated using the measured native PDF viewport top, not a guessed header
height. The native notes list sends the mark identity back to the renderer to
reveal the passage and open its comment thread. Stale-document selections cannot
create marks. Backgrounding and transient failures preserve unsent drafts;
authorization/account revocation clears inaccessible PDF state and private drafts.

PDF.js text layers supply local selection, while the existing server extraction
feeds overview and outline. `pending`, `ready`, `empty` and `failed` states gate AI
requests and explain unavailable text without inventing OCR or a new chat UI.
Pending metadata polling is bounded, cancellation-aware and restartable on
foreground/retry. Scanned or extraction-failed PDFs can remain visually readable
without promising selectable text or generated AI output.

### Verification and availability boundary

Run the repository entry points from the root:

```sh
pnpm mobile -- typecheck
pnpm mobile -- test
pnpm mobile -- bundle
```

PDF host regressions exercise the production screen, queue, cache, API and mark
model behind explicit native boundaries. The real-browser PDF tests exercise the
local worker, resource loading, rendered pages, selection geometry and bounded
page residency; check for skipped browser cases when the required local browser
is absent. Neither browser execution nor host tests prove WKWebView/Android
WebView selection handles, native keyboard/back behavior or visual acceptance.
See [PDF fixture verification](fixture-acceptance.md#pdf-fixture-verification) for
isolated native scenarios and evidence requirements.

Scoped native menu/annotation checks now pass on the updated host. The isolated
iOS 26.5 simulator's `strict14` run used a genuine long press and ordinary
center-target Highlight/Comment taps, with no system menu or menu items. It
verified the exact quote `text`, keyboard entry, submission and Notes restoration
of the highlight/comment. `lifecycle13` verified pages 2–4, zoom to 125%, Fit to
width at 100%, background/foreground retention at page 4/125%, and native
Back/Library/reopen restoration to page 4. Reopening starts at 100% fit width;
zoom is not persisted, unlike page-relative position. Earlier exposed-edge
success and failed attempts remain historical diagnostics, not the basis for
these strict passes.

A physical Android fixture run also verified only Slax selection actions,
highlight creation/removal affordances, comment submission and Notes reopening of
the saved passage/thread. The demonstrated retention/OOM path is now repaired:
detached navigation wrappers retained approximately 15 MB of PDF HTML per reset
and destroyed WebViews through transition lists. Detach now releases the heavy
HTML/document/WebView references, ends the child transition and rejects late
operations/events. After rebuilding the fixture, 15 resets retained exactly one
WebView; ten actual Library/PDF/Back cycles returned to zero WebViews after each
Back. Allocated Java heap stayed around 28–29 MB reading and 13.7–13.9 MB in
Library, with no OOM in the post-fix process log. This is bounded endurance
verification without Fast Refresh or process restarts during measurement, not an
unlimited soak result. Upstream transition lists may still retain lightweight
detached wrappers.

Real iOS and Android picker/copy/UI flows now pass with the synthetic import
fixture, including cancellation, file selection, saved/synchronization-pending
feedback and automatic Reader opening. Both used the same independently checked
285,847-byte PDF. iOS additionally verified temporary-copy cleanup. The native
picker, Expo file and upload client paths were real, but upload acceptance and
delayed SQLite publication were simulated locally: neither live backend upload
nor production PowerSync synchronization is established.

The earlier full-cache runs used `FixturePdfStorage` with real Expo file I/O and
retain that historical scope. New `reader-pdf-native-storage` runs close the
production-adapter and mid-flight lifecycle gaps on both platforms. Actual
`PdfFileStorage` diagnostics passed write/read, replacement, size, list and remove.
Each run retained a real 262,144-byte first block of the 1,071,078-byte document
with `complete:false`; native Home/background aborted the delayed second range,
and foreground retried and completed without redownloading the first block.
Independent hashing of the five native blocks matched document SHA-256
`e28e3c0b6a27a3aa7c565326748bf93c34986946cc58d0638aee687c3473b0c0`.
Synthetic-offline native reading reached page 30 without additional served PDF
bytes. Android retained one WebView after the flow; iOS `production-cache4`
records a passing XCTest with native Home and foreground input.

These results execute the production file adapter, queue/cache and lifecycle
against delayed closed fixture transport, not a live server outage or airplane
mode. Machine receipts retain `nativeInteractionVerified:false`; native input
results are separate evidence. Native concurrent reader/prefetch arbitration,
missing-block offline failure/recovery with the production adapter, process-kill/
restart, cross-page handle dragging and the complete platform/profile matrix
remain unverified. Host tests cover priority promotion/deduplication and restart
logic, but are not substituted for those broader native scenarios.

The local cross-renderer regression now exercises Web `geometry.ts`, real shared
`MarkManager`, `InlinePdfViewer` and the actual Web `drawPage` implementation,
alongside production `MobileRepositories` writes in in-memory SQLite and mobile
mark restoration. It checks both directions on a rotated page at different zooms,
exact document/page/text/quads, projected overlays and retained comment threads.
The combined source/interoperability group passed 10 tests with no skips. Its
local HTTP wiring is not live PowerSync/backend synchronization or acceptance of
the full Web application shell. The final integrated run after the Android
storage-path correction passed 860 mobile tests with no failures or skips,
TypeScript, both platform production bundles, API type checking, 32 strict
OpenSpec checks and the diff check. The correction also passed focused
storage/runtime tests, Kotlin/Swift host checks and its native flow. These results support
completed implementation tasks 18.2, 18.3 and 18.5 without certifying the remaining
live-service, concurrent-native, missing-block or full-matrix acceptance.

The current correction requires no new backend API or deployment: Mobile must
match the existing metadata and range contract described above. Live mobile
verification remains pending after that client change; no backend deployment has
been authorized or performed. Earlier claims that a new PDF endpoint must first
be deployed are superseded, not evidence that the existing service is absent. The user subsequently
authorized immediate preview 1.0.25 (763), confirmed prior build 762, and requested
no further tests. This preview does not certify the remaining acceptance or
require backend deployment before uploading. Standalone Share requires no
Firebase; its integration and admission requirements are removed, while main-app
Firebase and main/share identity, signature, version and App Group checks remain.
The previous unauthenticated browser attempt does not invalidate the user's
confirmed build input. Archive, export, upload and Apple processing still require
separate successful records; no upload is implied by this authorization.
