# Desktop implementation and acceptance record

Implementation change: `add-macos-desktop`; companion: `desktop-login-handoff`. Shared extraction: [PR #263](https://github.com/slax-lab/slax-reader/pull/263).

The current user-directed order is full feature code and a packaged app review first, then optimization and expanded unit tests. The following rows distinguish code/build preparation from installed or live-service acceptance.

| Area | Current evidence |
| --- | --- |
| Mobile extraction | 1058 Mobile checks passed; iOS/Android JS bundles exported; Kotlin/Swift native-resource harness passed before the code-first follow-up |
| Portable reader parity | HTML embedding, PDF bundle, manifest and licenses compared byte-for-byte; hashes in the reader-embed README |
| Login implementation | Additive Web/API/contracts code restored alongside the desktop code in the primary checkout; 22 API tests including real PostgreSQL concurrency and 34 Web auth tests passed before the follow-up |
| Desktop core | Initial pure Rust policy checks passed before the follow-up; expanded lifecycle/uploader/security tests postponed |
| Desktop frontend | Production build and TypeScript checks run while preparing the app; compile failures are repaired as part of delivery |
| Native shell | Packaged app observation must be recorded below; compilation alone is not acceptance |
| PowerSync fix/proof A | Excluded by the user; not repeated |
| Public release/minimum OS | Deferred section 9 decisions; not activated |

## Installed B checklist

Record exact app checksum/commit, OS, architecture, locale and appearance alongside screenshots. Check traffic lights, toolbar drag/resize, focused/unfocused Sidebar material, native Edit copy/paste/undo in real controls, account-aware Article commands/context menus, hide/close/Dock restore, tray quick add, actual sleep/wake, dark/light, accessibility changes and Stage Manager. Optional Liquid Glass remains off until evidence supports it.

## Installed C checklist

Exercise an actual packaged WKWebView. Record hostile article script/handler/frame and remote request denial, main IPC denial from opaque frames, random/stale resource handle rejection, postMessage source/channel/page identity, Unicode/cross-paragraph mouse and keyboard selection, resize/scroll geometry, image gallery, saved transcript/external YouTube action, local PDF worker/resources, ArrayBuffer range transport, PDF script/action denial, mark restoration and fully offline cached reading. Mock/DOM checks cannot replace those observations.

## Live handoff checklist

Requires a dedicated deployment with the additive migration and both desktop flags enabled. Check signed-in/signed-out Google and Apple, explicit account consent, switch/cancel, expired/wrong-state/replayed/duplicate callbacks, fixed deep-link delivery to the installed app and explicit Open Slax Reader retry. Never record a redeemable code, verifier, bearer session or account PII in acceptance artifacts.

## Final user-directed follow-up

Main and local host debug packages compiled successfully after replacing system Keychain access with app-owned credential files and adding environment command aliases. TypeScript, Rust compilation and IPC generation checks passed at that point. The global strict OpenSpec run reported 48 passing items and two unrelated pre-existing failures (`hide-youtube-pdf-labs`, `mobile-startup-offline-image-performance`).

The user then explicitly stopped testing and packaging. The subsequent direct RSS/Collection sidebar and detail/sidebar/search tag-filter changes are code changes only, with their generated IPC contract updated. They have not received another type/build/test/native acceptance pass, and the previously packaged app does not include these final presentation changes. No claim of full installed B/C acceptance or public release is made.

## Communication, performance and motion follow-up

After the event-driven watch, PDF range, cache-loop, reader progress, AI stream and motion changes, one verification pass ran on macOS 26.5.2 (arm64): `cargo fmt --check`, workspace Clippy with `-D warnings`, `cargo test -p slax-core` (9 passed), IPC drift check, `vue-tsc`, `vite build` and an unsigned `build:local` bundle (`Slax Reader Local.app`). `vitest run` exits non-zero because the Desktop app has no frontend test files. The packaged app was not launched; energy use, motion, vibrancy, scroll restoration and PDF range behavior have no installed observations yet.

## User-approved visual refresh

The warm-paper presentation was refined without changing IPC, storage, commands or reader sandbox behavior. On 2026-10-19 (macOS 26.5.2, arm64) the following checks ran:

- `pnpm desktop -- typecheck` passed.
- `pnpm -C apps/desktop frontend:build` passed (80 modules; CSS 33.48 kB, JS 270.19 kB before gzip).
- `pnpm exec openspec validate add-macos-desktop --strict` reported the change as valid.
- `pnpm desktop -- build:local` produced `apps/desktop/target/release/bundle/macos/Slax Reader Local.app` (33.55 MiB).

The unsigned packaged app was launched and observed in Chinese/light and English/dark appearance across the library, HTML reader, settings, collapsed sidebar and tag-filter popover. The library rendered from cached account data. The local API/Web services were not running, so the selected PDF retained its document header but did not paint its pages and the app showed a retry toast; PDF page rendering and live-service behavior remain unverified in this environment. No claim of complete installed B/C acceptance or public release is made.
