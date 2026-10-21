# Tasks

## 1. Preserve the baseline and measure the current Library

- [x] 1.1 Record the initial branch/HEAD and dirty-file inventory without changing pre-existing work; verify the implementation diff is distinguishable from the input baseline and document it in `validation.md`.
- [ ] 1.2 Capture Android/iOS Release startup and scroll profiles with complete 1k/10k synthetic lists, Collections, RSS and concurrent PDF caching; record device/OS/refresh rate, useful-first-row timing, JS/UI frames, heap, returned SQL bytes and SQL/mapping/queue timing so identical row sets and workloads can be compared.

## 2. Local presentation and avatar persistence

- [ ] 2.1 Introduce an admitted account/origin/generation-scoped Library snapshot owner; verify mounted tests for focus/remount, real empty/deletion updates, logout, same-user replacement and delayed prior-owner callbacks without blocking on credentials/sync.
- [ ] 2.2 Add a dedicated typed lightweight Library row projection returning the complete selected list without pagination or full metadata blobs; verify identical ordered IDs for complete 1k/10k fixtures, all sort modes, equal timestamps, inserts/deletes, Reader opening/title editing, and deep scroll with no data continuation query. Measure returned-byte and mapping/allocation reductions rather than row-count reductions.
- [ ] 2.3 Schedule initial local profile/source/row reads before optional warmup; verify cold offline startup, delayed credentials and delayed database admission with existing startup tests plus a native running scenario, retaining recovery and first-adoption verification.
- [ ] 2.4 Add bounded durable self/Collection avatar resources through typed cache adapters; verify atomic refresh, failed-refresh retention, restart/offline reuse, expiry/LRU and account/origin/cache-cleanup revocation with storage tests.
- [ ] 2.5 Document the presentation/cache ownership and refresh policy in `docs/mobile/architecture.md`; verify the written lifecycle matches the exercised cold restart and cleanup behavior.
- [ ] 2.6 Separate lightweight cache-status subscription/merge from article list data; verify a one-item download-state change replaces only that row, unchanged normalized status publishes nothing, and reading-position/image-manifest writes do not republish unchanged list rows. Measure SQL reruns separately from JS publication instead of claiming row-granular database invalidation.
- [ ] 2.7 Narrow Collection selector and profile projections to actual presentation/access fields and reuse admitted snapshots; verify unread/expiry/account transitions, search/detail access to omitted fields, watcher reuse and aggregate query plans for subscribed owners.

## 3. Drawer interaction exclusion

- [ ] 3.1 Add a single drawer phase/input-lock owner spanning activation, cancellation, reversal and dismissal; verify deterministic tests for reduced motion, interrupted close, cancelled opening and unmount.
- [ ] 3.2 Wire underlying row actions, long-press measurements, list native scroll/momentum and accessibility exclusion to the lock; verify mounted/native gesture scenarios for content taps, left swipes, vertical drag, ongoing momentum and stale callbacks during every active phase.
- [ ] 3.3 Exercise drawer controls, backdrop tap, Android Back and accessibility escape on both targets; record cancellation/restoration evidence and update the interaction boundary in Mobile architecture documentation.

## 4. API filtering and PDF body retrieval

- [ ] 4.1 Add backward-compatible shared search request typing and API validation for keyword plus optional tag UUIDs; verify existing keyword-only and malformed/empty/oversized request tests and contracts/API typechecks.
- [ ] 4.2 Resolve current owned all-tags candidates before FTS/vector retrieval and revalidate before response admission; verify both branches with all/one/no tags, unknown/foreign tags, trash, removal races, cached associations and filtered vector candidate recall.
- [ ] 4.3 Trace both URL and uploaded PDF fixtures through completed extraction and both index branches; verify body-only unique terms, owned UUID mapping, private ownership, tags, pending/empty/failed text and index failure/retry through integration tests. Repair only a demonstrated broken path and record whether any code correction was necessary.
- [ ] 4.4 Document the optional filter, AND semantics, compatibility and asynchronous PDF indexing boundary in the existing API documentation; verify request examples against the running local API without production indexing or deployment.

## 5. Local search controller and typed query

- [ ] 5.1 Add typed local-search ports/repositories for personal bookmarks, permitted Collections and synchronized RSS metadata with bounded pages; verify real SQLite fixtures for alias/title/description/summary/URL, Chinese text, literal wildcard punctuation, access expiry and later-page matches.
- [ ] 5.2 Implement the text/tag parser, bottom-selector selection and removable conditions with stable UUIDs; verify mixed keywords/tags, duplicate/unknown/deleted tags, paste, spaces, backspace and IME composition in policy and mounted-input tests.
- [ ] 5.3 Implement cancellable debounced local queries and stable local ranking; verify old-query/account/origin results cannot publish, tag-only search stays local, empty search shows sources and selected tags exclude unowned source content.
- [ ] 5.4 Document the local scope, RSS-window boundary and personal-tag limitation in Mobile documentation; verify 10k search timing against the design target and record any missed target explicitly.

## 6. Fullscreen UI and cloud merge

- [ ] 6.1 Add the Inbox search action and native fullscreen Search route using existing tokens/assets and Chinese/English strings; verify accessible names, safe areas, keyboard focus/submit, narrow and large-font layouts with mounted checks and actual native renders.
- [ ] 6.2 Compose the compact condition row and bottom tag selector, Collection/RSS sections, attributed virtualized article results and localized empty/error states; verify source selection and owned/Collection/RSS Reader navigation with return-state restoration.
- [ ] 6.3 Add explicit cloud submit with captured query/owner generation, cancellation, deduplicated submission and silent cloud failure/local-only retry; verify delayed, out-of-order, offline, failed, composing-Enter and mid-query-tag-edit scenarios without clearing local results.
- [ ] 6.4 Merge by verified personal bookmark identity, enhance existing rows in place and append remote-only hits; verify legacy ID resolution, not-yet-synced Reader opening, safe snippet rendering, unsynced local tags and separate Collection/RSS permission contexts.
- [ ] 6.5 Record the new route, source/tag defaults and result merge behavior in Mobile documentation; verify the documented flows against the running app and local API.

## 7. PDF acquisition and measured scroll correction

- [ ] 7.1 Implement contiguous automatic acquisitions up to 1MiB split into existing 256KiB blocks with overlapping foreground promotion; verify interrupted resume, existing-block skips and foreground/background request sharing in PDF/cache/scheduler tests.
- [ ] 7.2 Preserve Range validation and single full-body fallback coalescing; verify 206, ignored Range/200, invalid Content-Range/length, optional/mismatched ETag, SHA failure, revoked access and replacement against the actual API adapter and native transfer harness.
- [ ] 7.3 Exercise list-only PDF automatic acquisition followed by Reader open and offline relaunch; verify request traces, reused bytes, settings/cache-window exclusions and first-page/file-completion timings without adding a manual download action.
- [ ] 7.4 Apply measured Library context/header/row/text-layout corrections while retaining existing FlatList and gesture ownership; verify profile comparison, sort/swipe/anchor regressions and the design's first-row/frame targets under the original workload.
- [ ] 7.5 Document final batch/priority/cache behavior and measured results in Mobile architecture documentation and `validation.md`; distinguish unchanged existing Range support from improvements delivered here.

## 8. Integrated acceptance and handoff

- [x] 8.1 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, `pnpm api -- typecheck`, relevant `pnpm api -- test -- <test-files>`, strict OpenSpec validation and `git diff --check`; record exact results and any pre-existing failures in `validation.md`.
- [ ] 8.2 Run `pnpm mobile -- test:native-resources` and affected native build checks, then exercise the delta scenarios on Android/iOS and a running local API; record permissions, offline/cold-start, large-library, keyboard/gesture interruption, PDF search/download and theme/font/viewport evidence with explicit non-UI gaps.
- [x] 8.3 Prepare the running UI for human hands-on acceptance before a PR; implement and reverify requested adjustments, then record who/when/what was accepted in `validation.md`. This UI acceptance has no declared-gap completion path.
- [x] 8.4 Ask the human for the affected Mobile version/build decision after checks, showing the then-current metadata, recommended increment and CI effect; apply approved metadata through existing generation tooling or record an explicit decline, and do not finalize while unanswered.
- [x] 8.5 If a push/PR is requested, read `REVIEW.md`, complete its mandatory local passes, resolve Important findings, and prepare the repository PR template with OpenSpec linkage and a standalone verification record; verify no unauthorized deployment/publication or unrelated baseline edits are included.

## 10. Final search redesign and metadata follow-up

- [x] 10.1 Replace large chips and mismatched source/article layouts with a stable input, compact condition row, consistent source rows and one virtualized article list; cover grouped/scoped presentation with tests.
- [x] 10.2 Bound the bottom tag selector by viewport, keyboard and safe areas; cover independent option scrolling and reachable controls in mounted layout checks.
- [x] 10.3 Offer quick tag choices after `#`, consume the typed token and permit switching from source scope; cover mounted selection and IME submission.
- [x] 10.4 Remove the article-heading spinner and row-level saved-article fallback while retaining the category, host-left and date-right footer; cover pure presentation and mounted input behavior.
- [x] 10.5 Return target URL and user save time from final API admission, preserving narrow candidate enumeration and old-server compatibility; cover FTS/vector metadata, revoked admission and Mobile merge precedence.
- [x] 10.6 Fix same-query submission clearing local rows and retained signed-out account data bypassing cleanup at the next login; add behavioral regressions.
- [ ] 10.7 Complete the Android/iOS native layout matrix, large-font and keyboard/rotation checks, real API response exercise, Release performance comparison and remaining PDF native gesture acceptance. These are explicit review gaps, not claims of completed acceptance.

## Workflow follow-up

- Keep the completed Spotlight change and unrelated in-flight capability deltas unchanged.
- After merge, archive this change promptly through its own small PR and verify strict specs; archive is not an implementation task in this checklist.
- Any production index repair, API deployment, signed upload or store publication needs its existing separate authorization and evidence.

## 9. Accepted search feedback follow-up

- [ ] 9.1 Expose local/cloud loading feedback at submit and pending empty results, with no article-heading spinner; verify debounce, delayed response, failure, cancellation and stale callbacks without premature empty results.
- [ ] 9.2 Show only nonempty independently collapsible source/article groups; verify accessibility, source navigation, Reader return and no more-results action while articles are collapsed.
- [ ] 9.3 Correct the Inbox search lens/handle join and verify geometry plus running native appearance.
- [ ] 9.4 Support an optional LAN development session from ignored `deploy/mobile/.env` for `pnpm mobile -- dev`, `ios`, and `android` debug runs (Release variants stay default), without logging credentials or committing local secrets; a changed API origin clears local account data instead of migrating it, and development starts skip legacy database scanning/adoption through the native fresh-storage slot; verify the connected device reaches the intended API/sync services.
- [ ] 9.5 Restore the sidebar sync status block with its progress bar, keep the subscription promotion width bounded to the drawer, and guarantee the drawer never leaves both its dismiss surface and the covered content non-interactive; verify on the running app.
- [ ] 9.6 Attach Collection and RSS search hits to their own source groups, leaving only personal hits in the article group; keep source titles searchable from local data (including a feed title that differs from its remark) for untagged queries, and hide Collection/RSS sections when personal tags are selected; add an accessible clear action to the search input; local repository failures alone may show a retry, while cloud enrichment failures stay silent; verify on the running app.
- [ ] 9.7 Replace WebKit page zoom in the mobile PDF reader with an intercepted pinch gesture that previews with a transform and re-renders visible pages at the new 1x–3x scale; verify white-screen elimination, horizontal pan, text selection and marks at zoom on the running device.
- [ ] 9.8 Scope local search to a selected Collection or RSS source like a tag (single source chip, clears personal tags, no cloud request); verify source toggle, chip removal and no cloud call on the running app.
- [ ] 9.9 On rejected credentials, drop the session without a previous-account reauthentication prompt or route, preserve local data for Settings cleanup, and show the normal Login flow; verify a new account can sign in directly.
