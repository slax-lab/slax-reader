# macOS desktop development

The Desktop application uses Vue 3, Pinia and vue-i18n inside Tauri 2.12.4. `apps/desktop/crates/slax-core` owns account admission, HTTP, SQL, synchronization, cache files, reader composition and feature policies independently of Tauri. The native shell supplies restricted local credential files, menus, lifecycle/network/accessibility observation, dialogs, clipboard and signed-updater installation. See root [DESIGN.md](../../DESIGN.md) for the Desktop profile and [acceptance.md](acceptance.md) for observed acceptance rather than inferred compatibility.

## Commands

Use the repository Node LTS and pinned pnpm. Install from the repository root with `pnpm install --frozen-lockfile`. macOS, Xcode command-line tools and Rust 1.90 or newer are required for the shell. The Rust version is a build-tool requirement; the minimum supported macOS product decision remains deferred.

```sh
pnpm desktop -- dev             # local
pnpm desktop -- dev:preview
pnpm desktop -- dev:beta
pnpm desktop -- dev:main
pnpm desktop -- build           # main, host architecture
pnpm desktop -- build:local
pnpm desktop -- build:preview
pnpm desktop -- build:beta
pnpm desktop -- build:main
pnpm desktop -- typecheck
pnpm desktop -- ipc:generate
pnpm desktop -- ipc:check
pnpm desktop -- test:core
pnpm desktop -- test
pnpm desktop -- check
```

`build` produces a packaged `.app`, including reader assets and the frontend, for the host architecture. `--debug` requests a faster unsigned debug build. Tauri's internal `frontend:build` script only builds the frontend and does not recursively invoke the application build. Advanced universal packaging remains available with `pnpm desktop -- bundle --env <environment>` after installing both Apple Silicon and Intel standard libraries. This prepares an artifact without publishing, signing or notarizing it. Manifests under `apps/desktop/.artifacts/` record environment, identity, actual architecture and file SHA-256 values.

## Deployment environments

`dev` defaults to `local`; `build` defaults to `main`. The `:local`, `:preview`, `:beta` and `:main` suffixes select a fixed profile independently of Git branch or `SLAX_DESKTOP_ENV`. Public endpoint pairs and identities live in [`apps/desktop/config/environments.json`](../../apps/desktop/config/environments.json). Advanced `bundle --env` and release commands retain explicit environment selection; command aliases reject conflicting extra `--env` values. No command reads secret files.

| Desktop environment | Web build profile | API | Web | Callback scheme |
| --- | --- | --- | --- | --- |
| local | development | `http://localhost:8787` | `http://localhost:3000` | `slaxreader-mac-local` |
| preview | preview | `https://reader-api.slax.dev` | `https://r.slax.dev` | `slaxreader-mac-preview` |
| beta | beta | `https://api-reader-beta.slax.com` | `https://r-beta.slax.com` | `slaxreader-mac-beta` |
| main | production | `https://api-reader.slax.com` | `https://r.slax.com` | `slaxreader-mac` |

Local and preview are distinct: a local app uses local Workers and the local Web server; preview is the remote dev-branch deployment. The known remote URLs identify the target environment, not evidence that desktop login has been deployed there. The app title and bundle manifest identify the selected environment. Each has its own bundle identifier, credential directory and application-data root. Credentials, pending PKCE attempts and caches additionally bind the canonical API/Web pair, including paired endpoint overrides.

Desktop opens the selected environment's normal browser login flow. There is no extra native enable switch, endpoint banner or backend setup message in the product UI. Local Web/API development uses the existing loopback development profile automatically; remote environments retain deployment-owned API/Web enablement and limiter configuration. The operator starts the existing local services with `pnpm api -- dev` and `pnpm web -- dev`; native commands do not start or deploy those services.

```sh
pnpm desktop -- dev
pnpm desktop -- build:local --debug
```

The UI receives only public build configuration and sanitized account state. Environment identities remain distinct in application metadata and build artifacts; they do not add diagnostics to the login screen.

For a deliberate alternate deployment, override **both** non-secret `SLAX_DESKTOP_API_ORIGIN` and `SLAX_DESKTOP_WEB_ORIGIN`; a partial override fails. Local allows loopback HTTP(S), including a packaged local build. Remote environments require HTTPS and reject loopback targets. The user explicitly chose app-owned local credential files instead of system Keychain for all profiles. Rust stores the session and pending login in the environment/origin-scoped credentials directory with 0700 directory permissions, atomic 0600 files and no UI/IPC exposure. These files use filesystem permissions rather than Keychain encryption. Existing Keychain entries are not read or migrated; the first launch after this change requires one new browser sign-in.

## Browser authorization

Deploy the additive `desktop-login-handoff` change before enabling browser entry. Its off-by-default Web/API flags, trusted deployment identifier, dedicated limiter and PostgreSQL migration must be configured in that deployment. See [login-handoff.md](login-handoff.md). Local app builds do not enable a remote deployment or migrate production.

The native core creates PKCE verifier/state, stores the pending attempt in restricted native credential storage for ten minutes and opens the fixed Web consent URL. The browser callback contains only a one-time code and state. Rust handles only its environment-specific fixed `://auth` callback and exchanges it over native HTTP; Vue receives sanitized account state only. Duplicate successful callback delivery is coalesced. Sign-out requires explicit discard when pending writes remain.

The public API rate-limits handoff independently. A self-hosted development deployment must configure both sides consistently; browser-return parameters never grant a subscription or replace signed credentials.

## Reader and data ownership

`packages/reader-embed` owns unchanged portable bridge resources and PDF policies. Desktop owns `reader-frame/tauri-frame-host.js`, its sanitized document composition and binary PDF transport. The internal frontend asset build generates a local PDF.js legacy 6.4.299 runtime, worker, binary-resource map and license bundle before Vite/Rust compilation. Resource base64 in the bundled worker map represents static application assets; user PDF byte ranges use binary IPC and transferable ArrayBuffers.

HTML frames use an opaque `allow-scripts` sandbox. Their images are admitted, revocable `slaximg` capabilities, not arbitrary fetch URLs. Native IPC requires a main-frame-only capability plus account/document ownership checks. Direct remote scripts, frames, fonts and WebView networking are denied. YouTube transcripts remain readable; confirmed playback opens the original in the system browser.

The desktop core enables rusqlite's bundled SQLite feature. The system SQLite on the development Mac rejects static extension registration with SQLITE_MISUSE; the bundled library opens the application schema successfully. This is application linkage configuration, with no SDK patch. The already-fixed PowerSync 0.1.1 dependency is pinned unchanged in Cargo.lock. The application preserves schema version 2, `user_data_v1`, `subscribed_collections` and bookmark comment streams. No SDK repair, fork or proof A is part of this implementation. The uploader retains the existing server's 400 ambiguity and completes queued transactions only in order; retryable failures preserve the failed transaction and later work.

Closing hides the window; Dock activation restores the same runtime. Downloads follow account/network/sleep ownership, not window visibility. Native proxy notifications rebuild the reqwest client and reconnect the current account. Automatic caches honor latest 30/50/100/200/all, preserve manual intent and protect active reader/file leases during cleanup.

## Code-first review order

The user requested a complete packaged app before expanded optimization and unit tests. Compile/type/build repair is part of preparing that app. The implementation remains unmerged until the postponed tests, native B/C cases, required pre-push review and relevant CI checks are complete. Do not mark unexecuted service, signing or installed acceptance cases as passed.

## Workspace sources and tags

The sidebar lists RSS feeds and subscribed Collections directly below personal library navigation; there is no standalone RSS destination. A source selection uses the existing middle list and right reader. Collections come from admitted SQLite subscriptions and preserve source access and annotation policies. Tags are visible in bookmark details and can filter from the sidebar or search popover. Multiple tags use intersection semantics and combine with keywords in native SQLite; explicit cloud search retains the selected tag intersection.
