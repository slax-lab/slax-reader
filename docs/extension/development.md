# Extension local development and verification

[Extension architecture](architecture.md) · [Web development](../web/development.md) · [Chinese](development_CN.md)

## Configuration location

Extension configuration lives in `apps/extension/config`, with its schema in `apps/extension/env.schema.ts`.
The root `pnpm extension -- ...` command loads `.env.extension` and profile files from `deploy/local` (shared with the API and Web, distinguished by filename); development uses `.env.extension.dev`, while other profiles use `.env.extension.<SLAX_ENV>`. Process variables take precedence over file values.
The selected environment is read from process `SLAX_ENV`, then the deploy `.env.extension`, and defaults to `development`. A profile file cannot switch the selected environment. All root commands, including `dev`, `build` and `zip`, use this rule; the repository-root `.env` is not loaded automatically.
Direct app-package commands use the same deploy configuration and no longer read app-local environment files. Prepare your own files, do not copy them from the old repository, and never commit them.

Start with [`deploy/local/.env.extension.example`](../../deploy/local/.env.extension.example):

```sh
cp deploy/local/.env.extension.example deploy/local/.env.extension
```

Example values are local placeholders only. Extension configuration is included in the client bundle; never put server credentials in it.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | Required | Web origin and the origin hosting `/x/ext-bridge` |
| `AUTH_BASE_URL` | Required | Login entry point |
| `SHARE_BASE_URL` | Required | Sharing entry point |
| `EXTENSIONS_API_BASE_URL` | Required | Backend API URL |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | Required | Session-cookie settings shared with Web |
| `SLAX_ENV` | Optional, defaults to `development` | Environment, icon, extension ID and build settings |
| `UNINSTALL_FEEDBACK_URL` | Optional | Uninstall feedback page |

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

`pnpm extension -- dev` uses port 3001 and generates `.vendor/vendor.js` for faster development. Enable developer mode in Chrome or Edge, select **Load unpacked**, and load `apps/extension/build/chrome-mv3-dev`.
For `pnpm extension -- build`, load `apps/extension/build/chrome-mv3` and manually reload the extension after rebuilding. Public manifest keys are preserved across environments, so the extension ID and Web allowlist remain stable after the directory migration.

`.wxt`, `.vendor` and `build` are generated directories and must not be committed. Zip files are generated under `build`. Firefox commands remain available in the source; this migration verifies the Chromium path on Chrome and Edge and does not claim full Firefox verification.

## Optional isolated browser tests

The existing offscreen tests use a local test service and do not need a real API. Prepare Chromium or Chrome for Testing and set `CHROME_PATH` to its executable; other platforms should set it explicitly.

```sh
CHROME_PATH=/absolute/path/to/chromium HEADLESS=1 pnpm --filter @apps/slax-reader-extensions test:offscreen:e2e
```

This command rebuilds an instrumented test extension. Run `pnpm extension -- build` again before manual testing or packaging. Longer suites include `test:offscreen:401-soak` and `test:offscreen:timing`; they do not replace final backend integration.

## Contributing to Web and Extension

You can report issues, suggest improvements, or edit documentation and translations without a local setup. Include the location, environment, reproduction steps and expected versus actual behavior, and remove account details, private articles, cookies and tokens from logs or screenshots.

Small wording, translation and documentation changes can be made through GitHub's editor and proposed from a new branch. Larger changes should start with an Issue. Do not commit directly to `dev`, `beta` or `main`; behavior changes require a reviewed OpenSpec proposal, while documentation-only changes may use `OpenSpec: n/a`.

Translations live in `apps/web/i18n/locales` and `apps/extension/src/locales`. Preserve keys, placeholders, line breaks and JSON structure. Use an isolated worktree for code changes and report the actual checks run in the PR.
