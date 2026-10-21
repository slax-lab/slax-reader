# Design

## Context

See `proposal.md` for scope. The baseline is the primary worktree at `45e947b4` on `feat/fix-spotlight-index`, including the existing uncommitted Mobile changes observed on 2026-10-21. Those already remove visible startup spinners, isolate sync progress in `LibrarySyncAvatar`, cache Labs state, and increase automatic PDF admission windows. They are inputs to this plan, not changes produced by this planning session.

Observed code paths:

| Surface | Current implementation | Consequence |
| --- | --- | --- |
| Startup | `domain/session.ts::restoreLocal` publishes identity; `data/runtime.ts` opens/verifies storage, enters the account, then publishes upgrade readiness | Network refresh is already asynchronous; the remaining gap includes local admission, first query and competing services, not simply awaiting sync |
| Library | `screens/LibraryScreen.tsx` initializes empty rows/sources/user, subscribes after admission/focus; `watchBookmarks` reads all matching rows including full metadata and a cache-state join | New watchers can briefly lose useful snapshots; virtualization alone does not bound SQL/JS mapping work |
| Old client | `ui/Navigation.kt` releases the same-account shell before background refresh; `ui/inbox/ViewModel.kt` retains prior nonempty list snapshots through transient null emissions | Preserve this intent without bypassing the new account/database verification boundary |
| Sources/profile | Collection and user watches read PowerSync SQLite; `AppImage.tsx::DisplayImage` uses `cachePolicy="memory"` | Data is already persisted, but remote avatar bytes are lost across process termination |
| Search | No Search route/repository exists; API accepts only `{keyword}`; fulltext and semantic normalization both include title and body | Add local search and tag filtering while preserving the confirmed title-plus-body behavior |
| PDF transport/cache | API `bookmark.ts::getPdfResponse` behavior returns 206/416 using object ranges; Mobile `api.ts::transferPdf`, `BackgroundArticleCache` and `PdfBlockCache` already validate and share blocks | Improve scheduling and verify deployed responses rather than introducing a second downloader |
| Drawer | `SourceDrawer` animates on the UI runtime and overlays a scrim; `visible` changes through `runOnJS`, underlying children have no explicit pointer lock, rows arbitrate their own gestures | Activation, active scroll/row gestures and closing/cancellation need one input-exclusion lifecycle |

Existing unarchived changes own broad performance/PDF/RSS contracts. This proposal adds library search and refines the living library contract; it does not duplicate their delta files or claim their pending acceptance is complete.

## Goals / Non-Goals

**Goals:** Bound work on the useful first-frame and scrolling paths; keep one local source of truth and one PDF acquisition coordinator; expose deterministic search semantics with safe account/query replacement.

**Non-Goals:** No OCR, cloud search of another user's Collection body, search across uncached RSS history, new tag ownership for Collections/feeds, manual PDF download control, new background OS service, generic search infrastructure, UI framework replacement, or production index rebuild/deployment. App/system Spotlight remains separate from in-app search.

## Decisions

### 1. Local admission first, initial presentation before optional work

Keep separate milestones for local identity, verified database/account admission, initial visible rows/sources/profile, credentials, and sync. The initialized installation retains its bounded ownership/schema checks. First adoption or failed admission continues through explicit localized recovery. An identity token alone never authorizes displaying a pre-admission disk snapshot.

After admission, issue the complete selected list's lightweight projection and the existing local source/profile reads before low-priority warmup. Publish cached content immediately; refresh and sync never reset it to an empty/loading state. Retain an immutable account/origin/runtime-scoped in-memory snapshot across screen focus and watcher replacement. SQLite remains the durable business cache; do not serialize a second full bookmark database into preferences. A true empty result replaces stale data; do not preserve deleted rows indefinitely. On process restart read the admitted SQLite projection immediately rather than waiting for network validation.

The human explicitly requires no homepage pagination. Keep all matching rows for the selected Inbox, Starred, Archived or Collection list in one ordered subscription, with no first-50 cap, cursor, LIMIT/OFFSET continuation or scroll-triggered loading. FlatList retains its rendering virtualization over that complete dataset. Preserve source sort semantics and deterministic equal-time ordering, and reconcile inserts/deletes without changing the anchor. Reduce the width of the result, not its row count. Avoid creating custom tables/indexes in PowerSync internals. Examine query plans and benchmark projections before considering any app-local derived index. Keep credential checks on protected network operations; defer optional catalog, RSS poll, cache warmup and Spotlight publication until initial library presentation is scheduled. Security revocation is never deferred.

Introduce a dedicated typed Library row projection instead of reusing the full Reader `BookmarkRecord`. Its business fields are the saved ID, alias/title, URL, processing status, star state and archive state; the displayed download status comes from a separate lightweight overlay. Collection owner/access context remains explicit in the selected source/controller. SQL extracts only required JSON scalars and does not return the full `metadata` blob. Dates used only by ORDER BY stay in SQL rather than crossing into JS; include a projected timestamp only if an actual consumer needs it. Do not fill removed fields with fake empty values merely to satisfy the old record type. Reader details, descriptions, tags, summaries and cache-planner fields remain available through their dedicated repositories; opening a row or editing its title must not require loading every article's details.

Separate the article-list subscription from local download-state projection so reading-position, image-manifest and cache writes do not repeatedly rebuild the article join. Watch only cache keys and normalized visible download states needed by the active list, sharing existing cache-state infrastructure where practical. Reconcile the resulting map by ID (and Collection owner) with structural sharing: a changed status replaces only its affected row; a write that changes no displayed state publishes nothing. Retain immediate star/archive/delete feedback and replace true deleted/moved rows. SQLite/PowerSync can still rerun a subscription after table invalidation: do not claim per-row SQL execution merely because JS publication is incremental. Measure query time, returned bytes, mapping/allocation and row commits separately before and after splitting the join.

Give Collection selector and self-profile queries equally narrow projections: source ID/name/avatar, owner and current access/unread fields, plus the profile identity/display fields actually used by Library/sidebar. Replace `c.*` with explicit columns; read description/code and other search/detail fields through those features. Keep unread aggregation scoped to subscribed owners and measure its query plan; do not scan or parse article bodies for the selector. Share the admitted source/profile snapshots across focus changes rather than reopening identical watchers on every render.

Alternative rejected: hiding a spinner while leaving the same blocking work, adding a timer, or rendering unverified cross-account snapshots.

### 2. Fullscreen search composition and navigation

Add a native Search route, an icon beside the existing plus button, and a localized accessible name. Retain the centered Inbox title, safe areas and existing Mobile tokens. Search uses the native route back affordance, a growing tokenized input and an adjacent Search action; the keyboard Search/Enter invokes the same submit command. Focus the input on entry. Back with the keyboard open follows native dismissal; returning to Library or from Reader preserves source selection, query and list position under the same owner.

Order inside the search screen:

1. Search input containing removable selected-tag chips and editable free text, plus submit action.
2. One horizontal tag rail; selecting an item toggles its chip.
3. Collection source section, then RSS source section.
4. Unified article result section, containing own bookmarks, permitted local collection articles and local RSS entries, with source attribution.

With no keyword/tags, show the source sections and a neutral search hint, not all articles. Source sections filter locally by collection name/description and feed title/remark/site. Selecting a Collection/RSS source opens that existing Library source without inventing remote source search. Article results open their existing Reader context. RSS sections respect the existing Labs availability; search does not enable a disabled feature.

A selected personal tag constrains article results to tagged personal bookmarks, including an RSS/collection URL only when it is also an owned saved bookmark. Source sections then show a short localized explanation rather than suggesting their untagged content satisfies the filter. No implicit new tags are created. This is a deliberate default because Collections/feeds have no personal tag relation today.

### 3. Query and tag semantics

The query model stores `{text, tagUuids}` separately. `#prefix` starts local tag suggestions; choosing a suggestion, or committing an unambiguous exact name on space/submit, converts it into a chip. Unknown/ambiguous names remain editable with feedback and do not become a silently broader API query. Typing `#` alone does not submit an empty query. Match tags against current local names but submit stable UUIDs; deduplicate UUIDs. Backspace at an empty text segment selects/removes the trailing chip; each chip also has an accessible remove action. Keep Chinese IME composition intact: Enter that confirms composition is not a search submission. Support paste, Chinese text, leading/trailing spaces and tag names containing spaces through suggestion selection.

Multiple selected tags use AND, consistent with the existing backend multi-tag bookmark filter. Keywords AND tags. Tag-only queries execute locally; empty text never triggers embedding or a cloud all-document listing. Hidden tags are omitted from the default rail but remain available through explicit matching suggestions. Deleted tags invalidate the chip and cancel stale remote results rather than silently dropping its constraint.

### 4. Local search is independent of the visible Inbox window

Introduce a cohesive `search/` feature controller and typed search repository port. Screens compose presentation only; SQL lives in repositories and transport in `data/api.ts`. Query SQLite for all admitted matching personal metadata, permitted cached collection metadata and the locally synchronized RSS window, not the currently rendered Inbox array. Personal scope includes nondeleted Inbox, Starred and Archived records; Collections require active subscription/access, and unsaved RSS remains metadata-only.

Search alias/title, description/summary, URL/site and feed remark with normalized text. Use parameterized SQL, literal escaping for `%`, `_` and backslash, JSON tag membership for AND intersection, and bounded per-source pages. Normalize case/whitespace and support Chinese substring matching without requiring a new tokenizer. Debounce typing around 120ms; cancel/discard older query generations. Start with projected SQL and keyset paging; do not assume a local FTS extension exists. An optional future derived FTS index requires separate migration/admission analysis.

Rank local results by exact/prefix title, title substring, then description/site/URL match, with stable recency/id tie breaks. Show the first local page without network. First local paint p95 <=150ms after debounce is a proposed target on the declared reference device with 10,000 owned rows; it is not a measured claim. Record query/merge timing separately from keyboard/render timing.

### 5. Cloud submit, tag filtering and result merge

Extend the shared request shape compatibly to `{keyword, tag_uuids?: string[]}`. Omitted/empty tags preserve the current endpoint contract. Validate a nonempty trimmed keyword with a 500 Unicode code-point length bound and at most 20 distinct valid UUIDs. Resolve tag ownership in PostgreSQL; malformed input fails validation, and unknown/foreign tags produce no matches without revealing their owner. Use live user-bookmark/tag relations to build the owned, nondeleted, all-tags candidate set before fulltext shard-row and vector candidate retrieval. Recheck current ownership/tags before response publication; a five-minute unfiltered membership cache is insufficient as the final authority. Do not post-filter only a global vector top-K, which loses valid tagged matches. Preserve the shard selection changes already in the baseline. Do not log search text, document snippets, tokens, or tag names in new instrumentation.

The user explicitly confirmed title-plus-body retrieval. Keep existing FTS/semantic ranking and safe highlight handling; no embedding migration is required. A Search button or valid noncomposing Enter captures immutable text/tags/account/origin/generation. One submit means one remote attempt at a time; retries are explicit and bounded. Editing any constraint cancels/invalidate the attempt; a later response cannot overwrite newer results. Remote failures appear as a small inline retry state while local results remain usable.

Use typed result identities: `own:<bookmark_user_uuid>`, `collection:<owner>:<bookmark>`, `rss:<entry>`. Merge remote records only into personal bookmark identities; prefer the returned user UUID, resolve legacy encoded bookmark IDs through a typed metadata adapter when necessary, and support remote hits not yet synchronized locally. Keep local title/alias metadata authoritative when present and attach remote snippets/match sources. Render highlights as safe native text runs, not untrusted HTML.

Preserve the current local order during enrichment, enhance existing rows in place and append remote-only rows in backend rank order. Do not mix incomparable SQL match weights with RRF scores. Collapse RSS/Collection duplicates into an owned result only when a verified saved-bookmark relation exists; URL equality alone never merges different permission contexts. For selected tags, immediate local tag edits override stale cloud membership until sync catches up.

Alternative rejected: network calls on every keystroke, client-only API tag filtering, scoring all sources with arbitrary combined numeric weights, and dropping local results during cloud requests.

### 6. PDF search coverage is present in code and must be exercised

URL path: `capturePdf` -> `persistPdf(extract=true)` stores extracted text at `content_md_key` -> `crawlWorkflow`/`importParseWorkflow` reads that text -> `processPostHandler` -> `SearchService.addSearchRecord` writes fulltext and vector indexes. Upload path: `uploadPdf` initially persists metadata with pending text, creates the crawl workflow, and `capturePdf` later extracts the stored bytes and follows the same indexing path. `addSearchRecordByBmId` can also index an existing extracted text object.

Therefore both pipelines support PDF text in source code, but a searchable production document additionally requires completed extraction, successful index writes, user-index association and cache refresh. The code audit cannot establish the state of existing production indexes. Empty/scanned or failed extraction has no body to search; pending uploads are not immediately body-searchable. Tests must cover an exact term occurring only in an extracted PDF body, both index branches, both import paths, tag filtering, private ownership and failure/retry. If a specific regression is reproduced, fix that path idempotently. A bulk existing-document repair is a separately reviewed offline plan and authorized remote operation.

### 7. Durable avatar bytes and stable source snapshots

Keep Collection/user records in existing account-scoped SQLite and retain their admitted presentation snapshots across remount/focus. Add an explicit avatar resource role to the image/resource adapter, instead of globally changing `AppImage` caching for reader images. Persist self/Collection avatar bytes atomically under an account+origin scope with a stable resource identity, bounded size and LRU byte budget (initial ceiling 20MiB per account), then display the local URI through the existing native image cache. Store a compact manifest with identity/version, successful refresh time and expiry. Reuse the admitted local URI immediately; revalidate asynchronously after an initial 24-hour soft expiry. A changed URL/version refreshes atomically, and a failed refresh retains the same owner's last successful image. Clear/revoke manifests and display identities on account/origin replacement or explicit cache cleanup. Avoid per-render timestamps in cache keys.

Account-scoped owned storage is chosen over only setting Expo `memory-disk`: purgeable global URL caches alone do not establish the requested offline/cold-process availability, version freshness or owner cleanup. Use Expo's memory display acceleration over the authoritative local resource. Do not persist a duplicate copy of all ordinary reader images.

### 8. Measure and reduce Library scrolling work

Record a Release baseline from the current dirty worktree before implementation: cold identity->shell->first rows->interactive timings; SQL/mapping durations; JS/UI dropped frames; main-thread stalls; row commits; memory; background resource concurrency. Use 1,000 and 10,000 metadata fixtures with sources/avatars and simultaneous PDF caching. Run the same device/OS/build settings after changes.

Known candidates are the unnecessarily wide full-list projection and cache-state join, credential/context changes reaching the Library, source aggregate recomputation, and Android text metrics callbacks on mounting rows. Keep the full list while narrowing returned fields and separating download-state updates as specified in decision 1. Isolate durable account services from volatile readiness, preserve stable row references, memoize source/header components, and batch only noncritical background updates. Keep optimistic star/archive/delete feedback immediate. Existing `BookmarkRow` memoization, UI-runtime gestures, avatar-only sync state and 48ms position sampling are already present and must be preserved rather than counted as new fixes.

Compare the exact same complete ordered IDs before and after optimization for 1k/10k fixtures. Report total SQL result bytes, JSON scalars versus full metadata bytes, JS allocation/mapping time, changed-row commits and both cache-only and unrelated metadata-write workloads. Deep scrolling must require no further homepage data query. Search-result paging and the existing RSS history/cache windows belong to their own flows and do not limit the homepage article dataset.

First keep FlatList and fixed-row geometry; verify `getItemLayout` against actual header, separators and font scaling. Change batch/window parameters only with measurements. No per-frame React state or list-library replacement is assumed. Target first cached rows <=500ms after verified admission and no regression from baseline; target >=30% fewer dropped frames in the reproducible bad scroll case, or an already <1% dropped-frame rate, with p95 frame time within the display's frame budget. Hardware/device constraints and failed targets remain explicit, not assertions of universal smoothness.

### 9. Optimize the existing PDF Range and automatic-cache path

Range is already implemented end to end. Existing code uses 256KiB blocks, 1MiB automatic admission windows and a bounded shared scheduler; the current window batches four block requests, not one contiguous 1MiB HTTP transfer. Automatic cache candidates include personal Inbox and subscribed Collection PDFs before the Reader opens, subject to settings/limits. Instrument metadata wait, queue wait, first-byte, block/file commit and SHA time to locate the actual bottleneck.

Use validated contiguous acquisitions up to the existing 1MiB transport limit for automatic sequential filling, split/commit to the same 256KiB cache representation and skip existing blocks. Keep foreground page requests block-sized and promote/join overlapping in-flight automatic acquisition rather than downloading overlaps twice. Keep the existing global/per-host/foreground budgets first; tune only from evidence. Support resume from committed blocks and coalesce one streamed full-body response when a server ignores Range. Never mark a partial/uncertified file complete: retain MIME, 206 Content-Range/bounds/size, optional ETag identity, body length and final SHA-256 checks. Descriptor and definitive permission rejection invalidate the corresponding cache identity.

Treat "download in the list" as automatic app-foreground prefetch, consistent with the user's earlier removal of a PDF-specific offline action and generated Mobile rules. This does not promise downloads after OS suspension or prefetch every PDF outside the existing automatic-cache window. No new button, PDF badge or separate transfer service is added.

### 10. Drawer owns input from activation through final dismissal

Model closed, dragging-open, open, dragging-close and settling states in the drawer owner. The shared UI-runtime lock activates when the horizontal drawer gesture is recognized; fail/cancel competing row and native list gestures then, not only after the drawer reaches its threshold or React receives `open=true`. Suppress existing momentum as needed while preserving the stored offset. Cover revealed content with a stationary hit-test layer; disable descendant touch and accessibility focus/actions for the entire active period. Coordinate rows/native scrolling using the existing gesture APIs and shared lock, with React updates only at phase boundaries. A row callback/async measurement scheduled earlier rechecks the lock before opening/acting.

Release the lock only when dismissal finishes, including cancelled-open and interrupted/reversed animations; reduced motion has the same lifecycle. Preserve vertical scrolling while the opening gesture is still undecided, drawer-menu scrolling when open, scrim tap, Android Back and accessibility escape. Unit state tests alone do not prove native gesture exclusion; both platforms must be exercised.

## Risks / Trade-offs

- Literal substring SQL can scan many metadata rows -> bounded projections/pages, debounce, cancellation and measured 10k fixtures; introduce no unsupported FTS dependency as a guess.
- Snapshot reuse can hide deletions or account changes -> source/generation binding, explicit true-empty publication, live permission checks and immediate revocation.
- A complete Library dataset still has O(n) result/storage costs -> use narrow projections and stable objects, measure 10k returned bytes/heap/query time, and report remaining limits; do not silently reintroduce pagination or claim SQL cost is independent of list size.
- Partial API index failures can look like no matches -> tests at the real retrieval boundaries and explicit remote error evidence; preserve local results and do not claim complete production coverage.
- PDF larger batches can delay foreground reads or overfetch -> cap at 1MiB, share intervals, preserve foreground reservation and compare bytes/first-page time.
- Persistent avatar storage adds cleanup work -> role-specific bounded storage, atomic writes and existing owner cleanup boundary.
- New header controls/chips can crowd large text and keyboard layouts -> Mobile tokens, wrapping input, 44-point/dp target intent, narrow/large-font native checks and human hands-on acceptance.

## Migration Plan

1. Review this proposal, specs, UI semantics and ordered tasks. Preserve the user's existing dirty worktree and completed Spotlight plan.
2. Capture a reproducible baseline, implement local presentation/cache and drawer changes, then API filtering and local/cloud search, then measured PDF/list optimizations.
3. Run focused behavioral suites, root Mobile/API checks, native builds where affected, and actual Android/iOS plus local API acceptance. Record all results/gaps in this change's `validation.md`; planning does not pre-create successful evidence.
4. Prepare the running UI for the human's required hands-on review, implement adjustments and record who/when/what was accepted before opening a PR. Run the local review policy before any behavior-changing push.
5. Ask the combined application version decision after implementation checks. Current observed Mobile metadata is `1.0.25 (781)`, previous `780`; a proposed next patch/build must be rechecked against the then-current source and release conditions. Do not change it during planning or assume prior build approval covers this work. Mobile CI checks/bundles do not publish a store build.
6. An API deployment is separate authorization. Rollback the new route/filter calls and feature changes through the same branch/PR workflow; old keyword-only clients remain compatible and no sync data migration needs reversal. New derived avatar resources are safely disposable.
