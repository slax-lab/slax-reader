# Design

## Context

See [proposal.md](proposal.md) for motivation and scope. Discovery used `origin/dev` at `9949177`, not the unrelated task in the primary checkout. There is no desktop app or shared reader package. Root tooling uses small per-app command dispatchers and a pnpm workspace. The host reports macOS 26.5.2, Xcode 26.6, Node 22.22.3, and Rust/Cargo 1.97.1; this is environment discovery, not native acceptance evidence.

Relevant implementation owners:

| Concern | Existing evidence |
| --- | --- |
| Upload semantics | `apps/mobile/src/data/uploader.ts`, `tests/data/uploader.test.ts` |
| Credentials and account cancellation | `src/domain/token-policy.ts`, `session.ts`, `src/data/connector.ts`, `account-lease.ts` under Mobile |
| Cache and lifecycle | Mobile `src/data/background-cache.ts`, `cache-maintenance.ts`, `runtime-activity.ts`, `pdf-cache.ts`, `pdf-file-storage.ts` |
| Permission checks | Mobile `src/data/repositories/mark-policy.ts` and API sync orchestrator |
| HTML resources | Mobile `assets/embedded/`, `src/reader/generate-assets.mjs`, `document.ts`, `bridge.ts` |
| PDF build/runtime | Mobile `tooling/pdf-assets.mjs`, `src/reader/pdf-runtime.ts`, `pdf/runtime/*`, `pdf-geometry.ts`, `pdf-types.ts`, `pdf-errors.ts` |
| Protocol contracts | `packages/contracts/src/pdf.ts`, Mobile reader types/input/bridge parsers |
| Stream names and parameters | `deploy/local/powersync-local/sync_rules.yaml`, Mobile repositories/comments |
| Login integration | Companion `desktop-login-handoff`; existing Web login/auth middleware redirects signed-in users away from `/login` |

The user reports PowerSync is already fixed and explicitly excludes that work. Treat the working integration as an existing dependency: do not repeat PowerSync investigation, token remediation, SDK fork/patch/upstream PR work, or the original proof A. The original baseline predates that fix; do not turn its old token settings into new repair tasks. Pin the working dependency/revision during ordinary desktop integration and use its actual signed expiry. Local stream names are `user_data_v1`, `subscribed_collections`, `bookmark_comment`, and `collection_bookmark_comment`; preserve the existing `schema_version: "2"` contract without changing its ownership.

The supplied plan references an earlier feature inventory that was not attached. The scope matrix below makes this proposal independently reviewable using the supplied sections 1–8 and current Mobile capabilities.

## Goals / Non-Goals

**Goals:** Keep networking, SQL, credentials, synchronization and account admission in an independently testable Rust core; preserve the existing cross-platform data formats; make native platform behavior observable and verifiable; maintain separate shell and untrusted content boundaries.

**Non-Goals:** Windows/Linux/iOS desktop shells; a redesign of Web, Extension, or Mobile; native Share Extension; dark article content; optional metered-network download policy; a shared UI component system; changes to the sync API error contract; adopting section 9 defaults. Minimum supported macOS and final public distribution activation are intentionally deferred release gates.

## Decisions

### 1. Separate composition, core, and presentation

Use the directory layout from section 1: `apps/desktop/Cargo.toml` with `src-tauri/` and `crates/slax-core/`, plus `src/` and `reader-frame/`. `slax-core` has no Tauri dependency. The shell adapts restricted local credential files, windows, menus, system signals and channels to core ports. Vue/Pinia state consumes generated Rust DTOs through one thin invocation module; it never imports SQL or HTTP clients. Vue is already specified in section 1; this proposal does not independently resolve the section 9 frontend-choice question.

Use `ts-rs` for DTOs and a small typed command wrapper, with generation drift checks; pin its chosen version and all runtime dependencies when implementing. This avoids making an rc-stage tauri-specta release a contract dependency. The generated client is not an authorization boundary: every Rust command verifies its requesting main webview, account generation, document handle and operation permissions.

A public `config/environments.json` selects local/preview/beta/main API/Web origin pairs and distinct app identifiers and callback schemes. `dev` defaults to local loopback origins and `build` defaults to main; the `:local|preview|beta|main` suffix selects an explicit profile; preview maps to the dev release channel, beta/main retain their names, and local cannot publish or update. Credential-file and cache ownership additionally bind the origin pair. Desktop uses the normal selected-environment browser login flow with no additional native enable switch or setup banner. Local Web/API development activates the loopback profile; remote entry remains deployment controlled. Development commands never fall back to production.

Root dispatcher commands cover `dev`, `build`, `typecheck`, `test`, `check`, `bundle`, and explicit release operations. Unsupported hosts fail clearly. Shared Rust tests can run independently of a window. Public setup instructions use root abstractions.

### 2. Extract reader assets first without changing Mobile output

A separate `refactor/extract-reader-embed` branch/PR owns resource moves and import/build path updates. Do not put Mobile behavior deltas into the desktop change or overlap its `mobile-*` capability deltas with `expo-mobile-migration`.

Move portable embedded HTML/CSS/bridge assets and PDF runtime modules plus their portable dependency closure to `packages/reader-embed`. Preserve licenses, source manifests, ordering, esbuild version/options, PDF.js 6.4.299 legacy artifacts, worker resource hooks and module bytes. Keep `react-native-host.js` and the Mobile entry adapter host-owned; expose it under the same `nativeHostJs` embedding key. Shared code must not import `apps/mobile`. Resolve geometry/types/errors through portable exports or host ports, not relative imports back into Mobile. The existing PDF runtime currently references Mobile geometry/types/errors outside `pdf/runtime`, so a directory-only move is insufficient.

Before any move, generate and hash Mobile embedded output and PDF bundle/manifest/licenses with frozen tooling. After the move compare complete bytes, not only file size, screenshots or object shapes. Avoid adding wrappers, banners, import text or minification changes to the generated bundle. If relocation changes bundled bytes, adjust the build inputs/entry locations; do not normalize the difference away. Preserve `embedded.generated.ts` bytes during this extraction, using Mobile compatibility paths where needed. Compare emitted reader/PDF assets rather than claiming whole Expo archives are reproducible; record any nondeterministic archive metadata separately. Run existing bridge, assets, PDF interop, native-resource and Mobile architecture tests. Only the desktop PR adds its own host adapter and stricter CSP.

### 3. Core ownership and PowerSync

Pin Tauri `=2.12.4` and consume the user's already-fixed PowerSync integration with its documented Tokio/HTTP and connection-parameter support. Record the consumed revision and license. Do not fork, patch, repair, submit an upstream PR or schedule a separate PowerSync validation spike. Reuse existing streams and the working token contract; this desktop implementation still needs to wire its runtime to that dependency.

Each account runtime owns its credential flight, database, reqwest client, cache schedulers, active streams, query watchers and cancellation generation. Derive the directory key from canonical API origin and stable user UUID, not display email; store under `Application Support/app.slax.reader.mac/accounts/<digest>/`. Keep credentials in a separate storage port. Refuse path traversal and cross-account handles. Admission of an existing database gates local data use, while the login/shell can render without waiting for connectivity.

Port uploader ordering, transaction boundaries, 100-transaction collection, approximately 20-op batching, 200ms batch pacing, metadata/share diffs and isolated 400 rejection behavior. Retry network/auth/429/5xx failures without completing failed or later transactions. The existing API catch-all converts failures to 400; porting cannot repair that ambiguity. The standalone server fix is excluded; document the existing behavior without reopening PowerSync remediation or inventing an additional approval gate.

Cache sync credentials only for the current account/origin, coalesce refreshes, invalidate 60 seconds before signed expiry, and reject stale results after replacement. Keep both automatic streams and bookmark-scoped comment streams with 5-day TTL; restore subscriptions safely after reconnect. Surface stream/priority readiness rather than only a global connected flag. Pure-core ports and deterministic clock/fake-transport tests cover these policies.

### 4. HTTP and credentials

Use reqwest with rustls and `SlaxReader/macOS <version>`, aligning timeouts, retries, error classification and cache/PDF validation with Mobile. Ordinary desktop HTTP integration tests cover macOS system proxy behavior, changes while running, offline recovery and TLS failure; they are not a new PowerSync proof A. Inject a transport/proxy-policy port so client recreation can be added if the pinned client does not observe live settings; do not assume environment proxy variables establish Clash/Surge compatibility.

The user explicitly replaced the system Keychain requirement with app-owned local credential files for every environment. The native credential port uses an environment/origin-scoped 0700 directory and atomic 0600 files, denies unsupported keys and symlink targets, and exposes no credentials through IPC. Files are protected by filesystem permissions rather than Keychain encryption. Existing Keychain entries are not read or migrated; a new browser sign-in is required once. Store the pending login state/verifier with a 10-minute deadline and clear it on cancellation/success/expiry. Auth deep links terminate in Rust; JS receives only a sanitized auth state/user DTO.

For sign-out follow the earlier section 3 proposal: inspect pending changes, require an explicit discard decision if they remain, cancel writers/watchers/downloads, close database and revoke reader capabilities, then clear credentials and the account directory. This is proposed behavior, not a separate adoption of section 9. Never infer approval to discard from window close or a failed upload.

### 5. Typed IPC, watchers, and resource protocols

Command domains are `auth_*`, `library_*`, `reader_*`, `pdf_*`, `ai_*`, `rss_*`, `settings_*`. Use typed request/error/result DTOs, bounded sizes, validated identifiers and stable error codes. Watch calls accept a `Channel`, return `watch_id`, publish an initial snapshot, then coalesce updates to a latest-value window (initial target 100ms) and compare serialized DTOs before publication. Explicit cancellation, channel failure, actual webview destruction, account replacement and shutdown release the watcher; hide-on-close preserves the runtime but suspends hidden UI publication. Reopening rebinds watchers and requests a fresh snapshot.

PDF range commands validate document/version/range/limits in Rust and return `tauri::ipc::Response` bytes as ArrayBuffer. Do not base64-encode them. `slaxframe://` and `slaximg://` resolve unguessable, account/document-scoped handles through core caches; they are not arbitrary URL proxies. Bound MIME types, redirects, byte sizes and lifetimes; return no CORS wildcard permitting external origins to read account resources. Revoked handles fail even when a resource was previously cached.

Main CSP permits only exact IPC endpoints under `connect-src` and locally bundled assets/workers under the appropriate directives; dev-only Vite connectivity must not enter release. No wildcard HTTP/HTTPS connect, fetch, WebSocket, CSS URL, or remote font dependency is permitted. Restrict Tauri capabilities to the named main webview; no broad plugin HTTP/fs/shell/clipboard permissions for article frames. CSP alone does not establish isolation.

### 6. Reader trust and interaction

Rust parses/sanitizes saved HTML, removes article scripts/event handlers/active embeds, resolves known image sources into `slaximg` capabilities, and composes a desktop-specific document from shared resources. Use iframe sandbox `allow-scripts` without `allow-same-origin`. Only the trusted hashed/nonced reader bundle executes; no inline article handler, unsafe-eval, remote frame, remote script or direct network request is allowed. Desktop may need a separate template and CSP hashes because Mobile's template currently contains inline YouTube integration and host assumptions; do not modify the shared Mobile bytes to achieve desktop isolation.

`tauri-frame-host.js` adapts the existing channel/pageId protocol using `postMessage`. Parent checks `event.source === iframe.contentWindow`, channel, active pageId, bounded schema and allowed message type; opaque frame origin is not identity. Commands back to the frame include a request ID and active document generation; frame verifies `event.source === parent`, payload/schema and page identity. Core rechecks annotation permissions and document ownership; the iframe cannot choose raw commands, SQL, paths, or destinations.

Host Vue owns selection tools/comments/geometry, maps iframe coordinates after scroll/resize, and invokes native context menus through Rust. Preserve mouse `mouseup`/`selectionchange`, keyboard selection, Unicode and cross-paragraph paths. Copy selected text through a bounded native action, not arbitrary clipboard IPC. Confirm external HTTP(S) links before Rust opener dispatch; reject executable/file/application schemes. PDF uses locally bundled legacy PDF.js, disables document scripts/external actions, and uses the same mark schema as Web/Mobile with a desktop binary transport adapter.

The source request contains a real conflict: a direct YouTube iframe cannot play with no remote frames/scripts/connections. Proposed resolution for review: retain saved transcript/reading functionality and offer confirmed playback in the system browser. Do not weaken CSP or claim in-app YouTube playback passed proof C. If in-app playback is required, amend this proposal with a separately isolated player/network policy before implementation. This is an explicit review decision, not an unnoticed fallback.

### 7. Native shell and Desktop design profile

Add a Desktop (macOS) section and matrix rows to root `DESIGN.md` during implementation. Runtime values belong in `apps/desktop/src/styles/tokens.css`. Use native system font stacks, light/dark shell semantics, transparent root/sidebar, opaque reader surface, blur only where useful, visible focus and reduced-motion support. Reader content remains the Mobile light profile. Do not import Web theme values or reference snapshot directories as runtime assets. Interface labels are not selectable; content and editable controls remain selectable; buttons use the normal arrow cursor.

Overlay title bar, hidden title and traffic-light position align with real native controls. Use `sidebar` material with follows-window-active-state behavior by default. Only enable optional Liquid Glass fallback after installed proof B evidence. Rust observes accessibility reduced transparency and changes toolbar treatment to an opaque semantic surface immediately. A native adapter reports online/expensive/constrained network state and NSWorkspace sleep/wake. No downloader pause solely because the window is hidden.

App/Edit/View/Article menus and row/selection/link context menus use Rust menu actions. Edit uses predefined native items to preserve copy/paste/undo. Route navigation intents to the UI; execute data mutations through core and validate currently focused/selected state. Close hides; Dock reopen restores/focuses; Cmd+Q is real shutdown. The tray indicates sync and supports quick add without making a second data owner.

### 8. Feature and delivery ownership

| Phase | Concrete deliverables | Primary existing reference |
| --- | --- | --- |
| 0 | Native/reader evidence B/C, reader extraction, Desktop design/rules | Mobile data/reader tests; root design contract |
| 1 | Login/refresh/local credentials; streams/upload/watchers; Inbox/Starred/Archive; add URL, rename, delete, sync/recovery states | Mobile repositories, sessions, connector; companion login change |
| 2 | HTML reader, highlights/comments/replies, tags, reading position, AI overview/outline Channel streaming/cancellation, gallery, native menus, share link | Mobile reader bridge/controllers/repositories and existing REST contracts |
| 3 | Latest 30/50/100/200/unlimited article/image/PDF caching, manual download, cleanup/restart; range PDF, drag/drop/open panel import | Mobile cache/PDF core and shared PDF contracts |
| 4 | RSS feed/subscription/article operations; settings en/zh, profile/feedback, account deletion, subscription browser entry, clipboard/deep-link capture, tray; package/update validation | Mobile RSS/settings/account flows and existing API |

RSS, PDF acquisition and YouTube capture continue to respect existing account/server Labs eligibility; reading already saved content does not newly require opt-in. Web's hidden Labs rows do not authorize enabling features in desktop. Do not invent desktop-only server endpoints for features already covered by contracts. Reflect actual `sr_user_subscription` entitlement from synchronization; Stripe opens in the browser. No third-party analytics SDK; only first-party `/events` requests originate in Rust, using an explicit desktop source discriminator if existing validation requires extending it.

Prepare universal Intel/Apple Silicon packaging, Developer ID/notarization and signed-updater tooling described in section 6, with fail-closed verification and no credential values in artifacts. Channel mapping follows existing dev/beta/main promotion and CLI conventions, with separate desktop tags/assets and no reuse of CLI update artifacts. Default distribution activation and minimum macOS version remain deferred, so production publication cannot be marked complete yet. A release-only signing workflow requires explicit invocation and operator-provisioned credentials; PR CI never notarizes or publishes.

## Risks / Trade-offs

- [Custom-scheme iframe or WKWebView capability leakage] → installed malicious-frame/remote-navigation tests; stop rollout if IPC/resource isolation fails.
- [Strict CSP blocks YouTube] → proposed external playback above requires review; never silently relax isolation.
- [Pure refactor alters PDF bundle] → byte comparisons of deterministic emitted artifacts and no bundled host abstraction change in that PR.
- [Account/sleep races] → cancellation generations, closed database ownership and stale success/error tests.
- [Native validation and signing require external state] → evidence must identify exact OS/build/app checksum; missing installed-app, production rules, certificates or credentials remains an explicit unmet gate.

## Migration Plan

1. Review both proposals, including the explicit YouTube resolution; keep section 9 deferred.
2. Run the standalone reader extraction on `refactor/extract-reader-embed` with `OpenSpec: n/a` and byte evidence; merge it before rebasing desktop. No code changes occur as part of this planning workflow.
3. Implement the companion login change on `feat/desktop-login-handoff`, deploy its additive schema/API/Web support only through separately authorized environment workflows, and test it before enabling desktop login.
4. Implement desktop phase 0 proofs after proposal approval, record results with the matrix below, then complete phases 1–4. Human desktop UI review is based on the installed app.
5. Before pushing behavior changes run all three local pre-push review passes in `REVIEW.md`, fix Important findings and run strict OpenSpec validation. Each implementation task keeps its branch/PR and capability ownership; this worktree initially holds a review packet only.
6. Roll back by disabling desktop distribution/entry, preserving existing clients and data. Do not delete account databases on version rollback or remove additive login tables while an installed release may use them. Archive changes only after their implementation PRs merge.

### Required proof records

| Proof | Required cases | Evidence required before completion |
| --- | --- | --- |
| B: native | Packaged app traffic lights/menus/drag/close/Dock/tray; focused/unfocused; Stage Manager; light/dark; reduced transparency/motion; sidebar vs Liquid Glass | Actual installed `.app` build/checksum, OS/architecture, screenshots and manual observations per case |
| C: reader | Sandboxed IPC denial, hostile HTML/link/image/path probes, cross-scheme nested frames, stale postMessage, mouse/keyboard selection, image handling, transcript/external YouTube action, binary PDF ranges/marks/workers | Installed tests and network/IPC-denial observations, mark round trips, ArrayBuffer proof; no claims based only on mocks |

B/C have not been run in this planning change. PowerSync work and proof A are excluded by the user; this statement does not question or revalidate the completed fix. The host has tooling, but this change has no desktop binary or installed-app acceptance evidence yet. `pnpm api -- setup` can log in and alter local infrastructure; do not invoke it during planning or read secret files. Production sync rules and release credentials are operator inputs, never guessed.

## Open Questions

- Minimum supported macOS version and final distribution activation remain section 9 decisions, outside this review's requested defaults. They gate compatibility/release acceptance, not core architecture.
- Exact signing identity, updater public key/host, product release artwork and production-rule attestations are non-secret metadata to provide at release preparation; private material stays operator-managed.

## Reviewed interactive follow-up

The user's installed-app review requests a warm Web-aligned Desktop palette, persistent library/RSS three-column navigation, resizable sidebar/list widths and an icon-only sidebar. Layout preferences remain Rust-owned. Article titles and source metadata scroll inside their opaque document; the article body retains its own bridge container so cross-client selection paths are unchanged. Non-success bookmark states appear in the third column until synchronization reports success. Signed image-proxy URLs embedded in saved HTML are decoded to their original public image targets and fetched by the existing restricted native image loader.

Search defaults to a parameterized SQLite query across the admitted local library. Only an explicit Search more action starts a cancellable native cloud request, clears existing search results immediately and shows the cloud waiting state. Query, route and account changes invalidate previous work. Cloud result text is plain text, never injected HTML.

Comment synchronization uses the existing bookmark_comment stream with bookmark_uuid parameters. Each live reader owns its subscription; closing another document cannot retire it. Local writes remain visible while the matching subscribed rows synchronize.

The final sidebar follow-up removes the standalone RSS navigation entry. RSS feeds and subscribed Collections are listed directly below the personal library navigation in one persistent source list. A source selection changes only the middle article list and right reader. Collection sources and articles come from admitted SQLite rows, retain subscription/access and annotation permissions, and cannot mutate the source owner's personal library. The user explicitly stopped further tests and installed acceptance work for this iteration.

Bookmark detail tags appear as named chips with the existing editor. Tags are also directly selectable in the sidebar and from a search filter popover. Selected tags are combined by intersection with keywords in Rust SQLite queries and retained when filtering explicit cloud results. Tag changes cancel stale searches and return to local results; cloud remains an explicit action.
