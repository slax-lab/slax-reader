# Tasks

Implementation starts after human review of this change and the companion login proposal. All implementation tasks below remain unfinished. PowerSync remediation, SDK fork/patch/upstream work and the original proof A are explicitly excluded; consume the user's working integration. Section 9 decisions remain deferred. B/C denote the installed native and reader acceptance records described in the design.

## 1. Reader extraction prerequisite — separate refactor PR

- [ ] 1.1 Cut `refactor/extract-reader-embed` from `origin/dev`, keep this proposal packet separate, and record frozen Mobile embedded/PDF artifact hashes and bytes before editing; verify the baseline manifest includes generated embedding, PDF bundle, manifest and licenses.
- [ ] 1.2 Move portable embedded assets and their license/provenance into `packages/reader-embed`, keeping the Mobile host adapter owned by Mobile; verify the generator's output and provenance checks remain byte-identical.
- [ ] 1.3 Move the portable PDF runtime and required geometry/types/errors dependency closure without importing Mobile from the package; verify architecture checks and existing PDF interop tests pass.
- [ ] 1.4 Rewire Mobile build/test resource resolution while preserving PDF.js legacy version, resource hooks and esbuild inputs/options; verify complete pre/post output bytes match without normalization.
- [ ] 1.5 Run the existing Mobile assets/bridge/PDF/native-resource checks and publish the extraction PR with `OpenSpec: n/a` and comparison evidence; verify it contains no behavior or desktop CSP changes and rebase desktop after its merge.

## 2. Application skeleton and boundaries

- [ ] 2.1 Add the macOS Tauri 2.12.4 app, Cargo workspace and Tauri-independent `slax-core`; verify `cargo test -p slax-core` runs without launching a window.
- [ ] 2.2 Add Vue/Vite/Pinia/vue-i18n composition, en/zh locale entry points and frozen dependencies; verify frontend type checking and a production frontend build.
- [ ] 2.3 Add the root `pnpm desktop -- <command>` dispatcher for documented dev/build/typecheck/test/check/bundle operations; verify supported dispatch, unknown-command failure and unsupported-host diagnostics.
- [ ] 2.4 Add Rust DTO generation with a thin typed IPC client and domain command families; verify generation is deterministic and a drift check detects a changed Rust DTO.
- [ ] 2.5 Implement main-webview-only capabilities and release CSP with exact IPC endpoints and local assets/workers; verify a release configuration rejects remote connections and excludes dev-server exceptions.
- [ ] 2.6 Add the Desktop profile/theme rows to `DESIGN.md`, desktop-owned semantic tokens and scoped `.rulesync/` engineering rules, then run `pnpm agent:sync`; verify generated rules and `pnpm agent:check` are consistent.

## 3. Native shell and system adapters

- [ ] 3.1 Configure overlay title bar, native traffic lights, draggable toolbar, transparent sidebar and opaque reader surface; verify an unsigned packaged app opens with native controls and resizes without overlapping hit targets.
- [ ] 3.2 Implement light/dark shell tokens, system fonts, focus states, nonselectable labels and selectable reader/input content; verify en/zh, keyboard navigation and both shell appearances in the installed app.
- [ ] 3.3 Add runtime reduced-transparency/motion observation and opaque toolbar fallback; verify the running app responds to system changes and retains readable contrast.
- [ ] 3.4 Implement native App/Edit/View/Article menus, shortcuts and selection-aware enablement; verify Cmd+C/V/Z in real text controls and library commands on the intended selection.
- [ ] 3.5 Implement native row/selection/link context menus through authorized core actions; verify stale/unauthorized selections cannot execute mutations.
- [ ] 3.6 Implement hide-on-close, Dock restore/focus and orderly Cmd+Q; verify closing preserves one runtime and reopening rebinds UI state without duplicate tasks.
- [ ] 3.7 Add online/expensive/constrained network and NSWorkspace sleep/wake adapters; verify injected signal tests and actual sleep/wake do not treat a hidden window as system sleep.
- [ ] 3.8 Record installed evidence B for focus, Stage Manager, dark/light, reduced transparency/motion and sidebar versus optional Liquid Glass; verify each case identifies app checksum, OS, architecture and observed result before enabling an alternate material.

## 4. Account core and data publication

- [ ] 4.1 Implement canonical-origin/user account directories, database admission and generation/cancellation ownership; verify cross-account/path traversal and late success/error tests deny access or publication.
- [ ] 4.2 Add reqwest/rustls transport with desktop UA, Mobile timeout/retry/error policy and explicit ownership; verify bounded timeouts, transient failures, system-proxy behavior and client refresh after proxy changes as ordinary HTTP integration tests.
- [ ] 4.3 Implement the user-requested native local credential store for all profiles; verify 0700 directories, atomic 0600 files and no system Keychain access or credential exposure through generated DTOs/logs.
- [ ] 4.4 Wire the already-fixed synchronization integration into the desktop runtime, pin its consumed revision and preserve existing streams/parameters and actual expiry handling; verify the app uses that dependency without adding a repair, fork or standalone PowerSync validation task.
- [ ] 4.5 Port desktop uploader batching, metadata/share diffs and transaction completion policy from Mobile; verify the existing uploader scenarios pass in pure Rust, including retained queue order for retryable failures.
- [ ] 4.6 Implement typed repositories and initial/coalesced/deduplicated Channel watches with explicit watch IDs; verify burst updates are bounded and unsubscribe/channel failure/account retirement release their owners.
- [ ] 4.7 Implement admitted offline startup and truthful local/network/pending/stream status DTOs; verify cached library data can appear offline while stale credentials cannot dispatch protected requests.
- [ ] 4.8 Implement sign-out pending-write inspection, explicit discard choice, cancellation, resource revocation and account cleanup; verify cancellation preserves writes and late work cannot recreate files after accepted cleanup.

## 5. Desktop login consumer — depends on companion handoff

- [ ] 5.1 Generate/store pending verifier and state with a 10-minute deadline and open only the configured browser authorization URL; verify PKCE vectors, restart/cancel behavior and secret-free UI events.
- [ ] 5.2 Implement strict Rust deep-link parsing and duplicate-delivery coalescing for the fixed auth callback; verify wrong scheme/host/duplicate parameters/state/expiry and replaced attempts are rejected safely.
- [ ] 5.3 Exchange through the native transport, persist only still-current sessions and integrate credential refresh/account admission; verify no token/verifier is passed to JS or accepted after cancellation.
- [ ] 5.4 With the companion Web/API implementation available, install the bundled `.app` and exercise signed-in/signed-out Google/Apple consent, replay, expiry and explicit open-app retry; verify real callback delivery and record results rather than using `tauri dev` as acceptance.

## 6. Library user flows

- [ ] 6.1 Build Inbox/Starred/Archive navigation and virtualized or bounded library rendering on typed watches; verify list selection, empty/loading/error/offline states and en/zh labels with Tauri API mocks.
- [ ] 6.2 Implement add URL, rename, star/unstar, archive/unarchive and delete actions through core policies; verify local updates/pending writes and rollback/retry behavior without UI SQL/network calls.
- [ ] 6.3 Connect native commands and shell sync/recovery presentation to active selection/runtime; verify account change clears stale commands and keyboard/menu actions match toolbar behavior.

## 7. HTML reader and proof C

- [ ] 7.1 Compose desktop article documents in Rust with sanitized markup, trusted script policy and account/document-scoped `slaxframe`/`slaximg` handles; verify malicious scripts/handlers/frames/paths cannot execute, fetch or access unrelated resources.
- [ ] 7.2 Add `tauri-frame-host.js` and parent/child message validation with channel/page/request identity and disposal; verify wrong-source, malformed, oversized and stale messages produce no IPC action.
- [ ] 7.3 Render the sandboxed frame without same-origin permission and implement reading position/outline anchor restoration; verify installed WKWebView cross-scheme loading and saved reading progress.
- [ ] 7.4 Add host selection toolbar, comments/replies, tag editing and annotation permission checks; verify Unicode/cross-paragraph mouse and keyboard selections, geometry after resize/scroll and denied core mutations.
- [ ] 7.5 Add native selection/link menus, controlled clipboard actions and confirmed external opener; verify cancelled or executable-scheme links do not launch and copy targets the active selection.
- [ ] 7.6 Add cancellable AI overview/outline Channel streaming with failure/retry states; verify navigation/account replacement cancels the stream and ignores stale output.
- [ ] 7.7 Add image gallery and existing share-link controls; verify only admitted resources and authorized sharing actions are accessible, including denied/revoked states.
- [ ] 7.8 Apply the reviewed YouTube resolution without weakening CSP; verify saved transcript reading and confirmed browser playback, or amend specs first if in-app playback is required.
- [ ] 7.9 Record installed evidence C for denied iframe IPC, hostile content/resource requests, postMessage identity, selection/images and cross-scheme nesting; verify actual denial observations and network traces accompany mock/DOM test results.

## 8. Offline and PDF

- [ ] 8.1 Port automatic/manual cache intent, latest-N limits and bounded scheduler/retries; verify 30/50/100/200/unlimited policies and interrupted-job recovery with deterministic core tests.
- [ ] 8.2 Bind pause/resume to offline/sleep/account retirement while preserving hidden-window downloads; verify signal races create no duplicate jobs and resumed work remains account scoped.
- [ ] 8.3 Port cache cleanup/file leases and PDF range/length/identity/full-SHA validation against existing contracts; verify corrupt/truncated/mismatched/optional-ETag scenarios and active-reader protection.
- [ ] 8.4 Add a desktop adapter for bundled PDF.js legacy runtime using binary `tauri::ipc::Response` ranges and disabled document scripts/actions; verify renderer requests receive ArrayBuffers without base64 and invalid ranges fail.
- [ ] 8.5 Implement PDF page/text selection, interoperable marks, reading progress and cached offline opening; verify Web/Mobile mark fixtures round-trip and full offline reading uses only verified bytes.
- [ ] 8.6 Implement explicit PDF drag/drop/open-panel import with existing Labs, size/signature and account checks; verify invalid files fail before upload and accepted files enter the normal bookmark flow.
- [ ] 8.7 Extend installed evidence C with real PDF worker/resources, binary range transport, script denial, scrolling/selection and annotation restoration; verify each case records actual results.

## 9. Remaining product and macOS entry points

This task-group number is only a task index, not the excluded section 9 defaults from the supplied plan.

- [ ] 9.1 Implement RSS feed/subscription/article operations through existing contracts and account gates; verify loaded/empty/error/retry states and feature eligibility without new duplicate endpoints.
- [ ] 9.2 Implement user preferences, language, feedback and constrained confirmed account deletion; verify en/zh copy, server constraints, cancellation and failed-request recovery.
- [ ] 9.3 Add clipboard URL suggestions and validated confirm-before-save add deep links, retaining existing browser extension interoperability; verify no unsolicited page/clipboard event silently writes a bookmark.
- [ ] 9.4 Add first-party `/events` dispatch and any required desktop source validation; verify payloads exclude secrets/document content and no third-party analytics dependency is introduced.
- [ ] 9.5 Add browser subscription entry and synchronized `sr_user_subscription` presentation; verify browser-return parameters cannot grant entitlement.
- [ ] 9.6 Add menu bar sync status, show-window and quick-add controls using the existing runtime; verify actions with a hidden window do not create a second account owner.

## 10. CI packaging and handoff

- [ ] 10.0 Apply the user-requested local/preview/beta/main environment split across commands, origin pairs, app/credential/data/callback/update identities and Web callback selection; verify a packaged Local app opens normal browser login against loopback endpoints without extra environment/setup notices, and preserve postponed unit/live-service acceptance.

- [ ] 10.1 Add path-scoped `desktop-ci.yml` on macOS with shared dependency coverage and no release secrets/publication; verify workflow structure and a real CI run for relevant changes.
- [ ] 10.2 Wire formatting, Clippy/core tests, generated IPC drift, frontend types/Vitest with Tauri mocks/build and unsigned bundle smoke checks into root commands; verify the documented checks pass from a clean dependency install.
- [ ] 10.3 Add universal Intel/Apple Silicon packaging and separate desktop dev/beta/main artifact/update identities; verify architectures, channel metadata and reproducible artifact manifests in a local unsigned build.
- [ ] 10.4 Prepare explicit signing/notarization/updater operations without adopting deferred section 9 distribution/minimum-OS decisions; verify missing prerequisites stop release and tampered/wrong-channel updates are rejected. Actual public release remains pending those decisions and operator configuration.
- [ ] 10.5 Add development/acceptance/release runbooks using root commands and record the B/C/manual cold-start/offline/login checklist; verify links/commands and label any unexecuted native/release cases honestly.
- [ ] 10.6 Run `openspec validate --all --strict`, required local pre-push review passes from `REVIEW.md` and relevant checks; resolve Important findings, open the scoped desktop PR targeting dev with `OpenSpec: add-macos-desktop`, attach it to this chat and verify required checks. Archive only in a follow-up after merge.

## 11. Installed-app review follow-up

- [ ] 11.1 Rewrite Desktop presentation with Web-aligned warm tokens, persistent three-column RSS/library layout, adjustable dividers and persisted icon-sidebar preferences.
- [ ] 11.2 Move article headings into scrolling documents, repair saved image references and show non-success bookmark states in the reader column.
- [ ] 11.3 Implement SQLite-first search and an explicit cancellable Search more cloud action with cleared waiting results.
- [ ] 11.4 Correct comment stream parameters and document-owned subscription lifetimes so uploaded local marks remain visible.
- [ ] 11.5 Compile, package and inspect the updated local app; record actual observations without expanding deferred unit suites.

- [x] 11.6 Apply the requested dev/build environment command aliases (dev defaults to local; build defaults to main), remove system Keychain access and verify the resulting package compiles.

- [x] 11.7 Replace the RSS destination with a direct RSS/Collection source list and connect source selection to the existing middle list and reader. Further tests and installed acceptance are stopped at the user's explicit request.

- [x] 11.8 Display assigned tags in bookmark details and add sidebar/search tag intersection filters across native local and explicit cloud search. No additional testing or packaging is performed after the user's stop instruction.

## 12. Communication, performance and motion review follow-up

- [x] 12.1 Replace polling with change-driven pushes: table-scoped library watch with revisioned snapshots and separate sync-state updates, a document-scoped marks watch, native accessibility notifications and change-only tray/menu updates; pause document work while the window is hidden.
- [x] 12.2 Remove redundant core work: validate cached PDFs once and serve ranges by seek, single-flight downloads, shared SSRF-safe image client with bounded concurrency, event-driven cache scheduling without holding file locks across network I/O, skip no-op read/progress writes, local indexes, blocking work off async threads, atomic article writes, cached labs and static reader templates, concurrent cloud metadata.
- [x] 12.3 Throttle reader progress, coalesce AI stream chunks with per-run identity, deduplicate frame selection/resize messages and queue PDF ranges instead of failing.
- [x] 12.4 Improve reading and motion: keep the previous document until the next resolves, delayed loading state, pre-paint article position restore, rAF-coalesced dividers, memoized list rows, native modal dialogs, transform/opacity transitions honoring reduced motion, visible sidebar material and scroll reset on view changes.
- [x] 12.5 Run one desktop check and bundle after the changes; record the result without expanding installed acceptance.

## 13. User-approved visual refresh

- [x] 13.1 Refine the Desktop warm-paper token layer for stronger surface separation, editorial typography, soft elevation, dark appearance and a distinct pointer-selection treatment that does not show a hard focus rectangle.
- [x] 13.2 Recompose the sidebar, library/RSS list, reader empty/processing/notes states, settings cards, dialogs, dividers and article/PDF typography using the refined token layer while preserving all existing commands, data flow and accessibility labels.
- [x] 13.3 Verify the refreshed presentation with `vue-tsc`, the frontend production build, targeted OpenSpec validation and a rebuilt local app screenshot review in light/dark and Chinese/English before recording actual observations.
