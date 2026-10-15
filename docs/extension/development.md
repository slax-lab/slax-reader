# Extension local development and verification

[Extension architecture](architecture.md) · [Web development](../web/development.md) · [Chinese](development_CN.md)

## Configuration location

Extension configuration lives in `apps/extension/config`, with its schema in `apps/extension/env.schema.ts`.
The root `pnpm extension -- ...` command loads `.env.extension` and profile files from `deploy/local` (shared with the API and Web, distinguished by filename); development uses `.env.extension.dev`, while other profiles use `.env.extension.<SLAX_ENV>`. Process variables take precedence over file values.
The selected environment is read from process `SLAX_ENV`, then the deploy `.env.extension`, and defaults to `development`. A profile file cannot switch the selected environment. All root commands, including `dev`, `build` and `zip`, use this rule; the repository-root `.env` is not loaded automatically.
Direct app-package commands use the same deploy configuration and no longer read app-local environment files. Prepare your own files, do not copy them from the old repository, and never commit them.

## First-run preparation

After creating the Extension environment file below, run the read-only checks
and Extension preparation from the repository root:

```sh
pnpm preflight --app extension
pnpm extension -- setup
```

`pnpm setup:all` performs API, Web, and Extension setup in one ordered
workflow. Run `pnpm extension -- setup` again after removing `.wxt/` or local
build caches. Setup prepares WXT state; it does not start
`pnpm extension -- dev` or prove that Web/API integration is available.

Missing WXT preparation or an invalid `PUBLIC_BASE_URL` blocks startup.
Missing login/sharing URLs, API URL, or cookie settings permits startup but
limits the corresponding features.
Both failure classes make preflight exit non-zero. See
[preflight status meanings](../LOCAL-SETUP.md#reading-preflight-results).

Start with [`deploy/local/.env.extension.example`](../../deploy/local/.env.extension.example):

```sh
cp deploy/local/.env.extension.example deploy/local/.env.extension
```

Example values are local placeholders only. Extension configuration is included in the client bundle; never put server credentials in it.

| Variable                             | Required                            | Purpose                                            |
| ------------------------------------ | ----------------------------------- | -------------------------------------------------- |
| `PUBLIC_BASE_URL`                    | Required                            | Web origin and the origin hosting `/x/ext-bridge`  |
| `AUTH_BASE_URL`                      | Required                            | Login entry point                                  |
| `SHARE_BASE_URL`                     | Required                            | Sharing entry point                                |
| `EXTENSIONS_API_BASE_URL`            | Required                            | Backend API URL                                    |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | Required                            | Session-cookie settings shared with Web            |
| `SLAX_ENV`                           | Optional, defaults to `development` | Environment, icon, extension ID and build settings |
| `UNINSTALL_FEEDBACK_URL`             | Optional                            | Uninstall feedback page                            |

See the schema for other optional fields. The Extension does not need `SLAX_API_CONFIG` or `deploy/local/api.toml`, but its features still require reachable Web and backend services.
Development configuration normalizes `http://127.0.0.1:3000` Web and sharing URLs to `http://localhost:3000` and adjusts the cookie domain. Use the same hostname for Web and Extension integration.

## Verification commands

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm extension -- typecheck
pnpm extension -- test
pnpm extension -- build
pnpm extension -- zip
```

`pnpm extension -- typecheck` builds the selection engine, runs `wxt prepare` and then `vue-tsc`. Tests perform the same selection and WXT preparation. `build` and `zip` build the selection engine first. The authoritative command list is in `apps/extension/package.json`.

For a build-only check, use local placeholder configuration in the current shell:

```sh
export SLAX_ENV=development
export PUBLIC_BASE_URL=http://localhost:3000
export AUTH_BASE_URL=http://localhost:3000
export SHARE_BASE_URL=http://localhost:3000
export EXTENSIONS_API_BASE_URL=http://localhost:8787
export COOKIE_DOMAIN=localhost
export COOKIE_TOKEN_NAME=slax_test
pnpm extension -- build
```

These values do not start the API and do not prove that login or synchronization works. A development `wxt build` is not production configuration verification. Real API integration is part of final acceptance after all frontend work is complete.

## Loading and development

`pnpm extension -- dev` uses port 3001 and generates `.vendor/vendor.js` for faster development. Enable developer mode in Chrome, select **Load unpacked**, and load `apps/extension/build/chrome-mv3-dev`.
For `pnpm extension -- build`, load `apps/extension/build/chrome-mv3` and manually reload the extension after rebuilding. Public manifest keys are preserved across environments, so the extension ID and Web allowlist remain stable after the directory migration.

`.wxt`, `.vendor` and `build` are generated directories and must not be committed. Zip files are generated under `build`. Firefox commands remain available in the source; this migration verifies the Chromium path on Chrome and does not claim full Firefox verification.

## Optional isolated browser tests

The existing offscreen tests use a local test service and do not need a real API. Prepare Chromium or Chrome for Testing and set `CHROME_PATH` to its executable; other platforms should set it explicitly.

```sh
CHROME_PATH=/absolute/path/to/chromium HEADLESS=1 pnpm --filter @apps/slax-reader-extensions test:offscreen:e2e
```

This command rebuilds an instrumented test extension. Run `pnpm extension -- build` again before manual testing or packaging. Longer suites include `test:offscreen:401-soak` and `test:offscreen:timing`; they do not replace final backend integration.

## PDF save verification

`node apps/extension/tests/pdf-browser.mjs` builds an isolated fixture with synthetic configuration under `apps/extension/build/pdf-popup-e2e`. It uses disposable Chrome state, real toolbar action dispatch with automatic saving, the shared collection-feedback overlay on the original source page, valid generated PDF bytes, and a mock API. The fixture checks direct local upload, public suffix/extensionless URLs, HTML at a `.pdf` path, disabled Labs, and repeated-action reuse. Source invalidation and account changes also have focused unit coverage. It also disables file access through Chrome settings, invokes the native action bubble, verifies its screenshot and visible recovery controls, opens the correct extension settings, enables access and reinvokes from the original PDF to upload automatically. Playwright omits native action popups from its page list, so the fixture inspects the actual browser-created popup target through CDP. Alt+Y and context-menu entry points share the dispatcher; this fixture exercises the toolbar. Screenshots are under `apps/extension/build/pdf-browser`. The fixture uses a mock API and must not be installed for regular use; manual end-to-end acceptance is recorded below.

The `file:///*` host permission permits reading the already-open PDF only after the browser's file access toggle allows it. No optional-permission request changes that toggle. A permission change can reload the extension and clear session operations; return to the original PDF and invoke toolbar/Alt+Y again. Retry within a surviving page rechecks source, account and permission. Cancel cannot undo an already accepted server request; uncertain submissions require explicit retry after checking the bookmark list.

Before installing a regular unpacked build, rebuild with the intended public Web/API origins and environment-specific extension ID, inspect `build/chrome-mv3/manifest.json`, and run the standard commands above. Local installation does not authorize Chrome Web Store publication. The human reported completing manual end-to-end verification for this change on 2026-10-15. The automated fixture records Chrome toolbar behavior separately from that manual acceptance.

## Contributing to Web and Extension

You can report issues, suggest improvements, or edit documentation and translations without a local setup. Include the location, environment, reproduction steps and expected versus actual behavior, and remove account details, private articles, cookies and tokens from logs or screenshots.

Small wording, translation and documentation changes can be made through GitHub's editor and proposed from a new branch. Larger changes should start with an Issue. Do not commit directly to `dev`, `beta` or `main`; behavior changes require a reviewed OpenSpec proposal, while documentation-only changes may use `OpenSpec: n/a`.

Translations live in `apps/web/i18n/locales` and `apps/extension/src/locales`. Preserve keys, placeholders, line breaks and JSON structure. Use an isolated worktree for code changes and report the actual checks run in the PR.

Guides that show a large or complex browser surface should use a real screenshot of that surface rather than a generated illustration. A small, simple control can be drawn in code instead. The file-access guide in `PdfSave.vue` is such a case: it is HTML and CSS imitating Chrome's "Allow access to file URLs" row with the switch on, so its label follows the extension locale (`pdf_save.permission_toggle_label`). Its Chrome blue is a documented design exception for a depicted third-party control and does not follow the Extension palette. The row is a single `role="img"` with `pdf_save.permission_image` as its accessible name and its children hidden from assistive technology. Recheck it against the real Chrome extension settings row when Chrome changes that page.

Local collection titles prefer PDF XMP dc:title, then document-info Title. The backend also resolves a confident first-page heading before falling back to the filename without its PDF suffix, and returns its authoritative title to the popup. The original basename and raw bytes remain unchanged in upload. Updated backends persist and return the title before confirming upload while text extraction continues asynchronously; an explicit repeat save repairs older filename titles without changing user aliases. A confirmed upload uses the backend numeric bookmark ID and UID, and subsequent extension synchronization failures do not replace saved feedback with an uncertain-request error. Backend deployment is required for the initial-list title correction; updating only the extension corrects local popup feedback.
