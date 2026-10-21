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
- [ ] 5.2 Implement the text/tag parser, rail selection and removable chips with stable UUIDs; verify mixed keywords/tags, duplicate/unknown/deleted tags, paste, spaces, backspace and IME composition in policy and mounted-input tests.
- [ ] 5.3 Implement cancellable debounced local queries and stable local ranking; verify old-query/account/origin results cannot publish, tag-only search stays local, empty search shows sources and selected tags exclude unowned source content.
- [ ] 5.4 Document the local scope, RSS-window boundary and personal-tag limitation in Mobile documentation; verify 10k search timing against the design target and record any missed target explicitly.

## 6. Fullscreen UI and cloud merge

- [ ] 6.1 Add the Inbox search action and native fullscreen Search route using existing tokens/assets and Chinese/English strings; verify accessible names, safe areas, keyboard focus/submit, narrow and large-font layouts with mounted checks and actual native renders.
- [ ] 6.2 Compose the horizontal tag rail, Collection/RSS sections, attributed virtualized article results and localized empty/error states; verify source selection and owned/Collection/RSS Reader navigation with return-state restoration.
- [ ] 6.3 Add explicit cloud submit with captured query/owner generation, cancellation, deduplicated submission and inline retry; verify delayed, out-of-order, offline, failed, composing-Enter and mid-query-tag-edit scenarios without clearing local results.
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
- [ ] 8.3 Prepare the running UI for human hands-on acceptance before a PR; implement and reverify requested adjustments, then record who/when/what was accepted in `validation.md`. This UI acceptance has no declared-gap completion path.
- [x] 8.4 Ask the human for the affected Mobile version/build decision after checks, showing the then-current metadata, recommended increment and CI effect; apply approved metadata through existing generation tooling or record an explicit decline, and do not finalize while unanswered.
- [ ] 8.5 If a push/PR is requested, read `REVIEW.md`, complete its mandatory local passes, resolve Important findings, and prepare the repository PR template with OpenSpec linkage and a standalone verification record; verify no unauthorized deployment/publication or unrelated baseline edits are included.

## Workflow follow-up

- Keep the completed Spotlight change and unrelated in-flight capability deltas unchanged.
- After merge, archive this change promptly through its own small PR and verify strict specs; archive is not an implementation task in this checklist.
- Any production index repair, API deployment, signed upload or store publication needs its existing separate authorization and evidence.
