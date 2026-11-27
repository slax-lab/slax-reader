# Slax Reader Browser Extension

The Chrome extension built with WXT 0.21 and Vue 3. It preserves the pinned Manifest V3 source snapshot and its existing capabilities.

[Development and contribution guide](../../docs/web/development.md) · [Chinese](README_CN.md)

## Start developing

Copy the Extension environment example first, then run these commands from the
repository root. Use Node.js 22.22.2+, 24.15.0+ or 26+, and the pnpm 11.25.0
version pinned by the repository:

```sh
cp deploy/local/.env.extension.example deploy/local/.env.extension
pnpm install --frozen-lockfile
pnpm preflight --app extension
pnpm extension -- setup
pnpm extension -- dev
```

For a complete repository initialization, use `pnpm setup:all`. Rerun
`pnpm extension -- setup` after removing `.wxt/` or local generated state.

Set the public local configuration using the [configuration and verification guide](../../docs/extension/development.md). Login, bookmark synchronization, highlights and comments need a working Web and backend environment; a successful build or extension load does not prove those flows are integrated.

## Common commands

```sh
pnpm extension -- typecheck
pnpm extension -- test
pnpm extension -- build
pnpm extension -- zip
```

The commands build the shared selection engine automatically; type checks and tests also generate WXT types. The development command pre-bundles vendor assets, while `build` and `zip` preserve the existing normal and vendor-aware packaging paths.
The package name remains `@apps/slax-reader-extensions`; its files live in `apps/extension`.

[Extension releases](../../docs/extension/RELEASE.md) documents automatic post-merge ZIP packaging, channel versions and public GitHub Environment configuration.

After a build, enable developer mode at `chrome://extensions` or `edge://extensions`, choose “Load unpacked”, and select `apps/extension/build/chrome-mv3`. The development server uses `build/chrome-mv3-dev`; keep these directories separate.

## Saving PDFs

Open the toolbar popup or press Alt+Y on an online PDF or an already-open local PDF, then choose **Save current page**. The collection feedback appears in an injected overlay on the original PDF page and submits online URLs for server processing. The acknowledgement confirms submission. PDF processing continues separately. For protected downloads requiring website cookies, download the PDF, open it in Chrome, and choose **Save current page** from the toolbar popup.

Without file access, Chrome prevents page injection, so the toolbar popup shows localized steps, an illustration of the switch, and an action opening this extension’s details. Enable **Allow access to file URLs** there. Changing file access can restart the extension and close its page. Return to the original PDF and choose **Save current page** again. Local PDF saving also requires **PDF bookmarks** to be enabled under Labs in Slax Reader Settings.

Files must be nonempty PDFs at most 50 MiB. Upload sends the file bytes and basename to the configured Slax API, not the filesystem path. Uploads retain existing private-bookmark rules. Short-lived source metadata stays in extension session memory; bytes and session tokens are not persisted by this flow. The already-open file is read directly after permission is enabled; there is no file picker in this flow.

## Where to make changes

- Extension UI: `src/components`
- Translations: `src/locales/en.json`, `src/locales/zh_CN.json`
- Background scripts, page injection and Web integration: `src/entrypoints`, `src/bridge`
- Manifest and build configuration: `wxt.config.ts`, `config`, `plugins`
- Automated tests: `tests`
- [Architecture](../../docs/extension/architecture.md)
- [License](../../LICENSE) · [NOTICE](../../NOTICE)

Local collection titles prefer PDF XMP dc:title, then document-info Title. The backend also resolves a confident first-page heading before falling back to the filename without its PDF suffix, and returns its authoritative title to the popup. The original basename and raw bytes remain unchanged in upload. Updated backends persist and return the title before confirming upload while text extraction continues asynchronously; an explicit repeat save repairs older filename titles without changing user aliases. A confirmed upload uses the backend numeric bookmark ID and UID, and subsequent extension synchronization failures do not replace saved feedback with an uncertain-request error. Backend deployment is required for the initial-list title correction; updating only the extension corrects local popup feedback.
