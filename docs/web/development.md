# Web local development and verification

[Web architecture](architecture.md) · [Extension development](../extension/development.md) · [Chinese](development_CN.md)

## Configuration ownership

Web configuration lives in `apps/web/config`, and its environment schema is `apps/web/env.schema.ts`.
The root `pnpm web -- ...` command loads `.env.web` and profile files from `deploy/local` (shared with the API's own `.env`/`.env.dev`, distinguished by filename); the development profile uses `.env.web.dev`, while other profiles use `.env.web.<SLAX_ENV>`.
`.env.web.dev` overrides `.env.web`, and variables already present in the process take precedence. Direct app-package commands use the same deploy configuration and no longer read app-local environment files.
The selected environment is read from process `SLAX_ENV`, then the `SLAX_ENV` value in the deploy `.env.web`, and defaults to `development`. A profile file cannot switch the selected environment. All root commands, including `dev` and `build`, follow this rule; the repository-root `.env` is not loaded automatically.
Environment files are prepared by the contributor, are not committed, and must not be copied from the old repository.

Start by copying [`deploy/local/.env.web.example`](../../deploy/local/.env.web.example):

```sh
cp deploy/local/.env.web.example deploy/local/.env.web
```

The example values are for local placeholders only. Google OAuth is required for Web login; Apple OAuth and Turnstile are optional. Real OAuth, Turnstile, push and Stripe configuration must be supplied by the developer.

| Variable | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `SHARE_BASE_URL` | Required | Local Web, login and sharing origins |
| `DWEB_API_BASE_URL` | Required | API service URL, normally provided by `apps/api` for local integration |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | Required | Local session-cookie configuration |
| `GOOGLE_OAUTH_CLIENT_ID` | Required | Google Web OAuth client ID |
| `APPLE_OAUTH_CLIENT_ID` | Optional | Apple login button; empty hides the option |
| `TURNSTILE_SITE_KEY` | Optional | Turnstile; empty skips the related verification |
| `SLAX_API_CONFIG` / `deploy/local/api.toml` | Web dev only | API configuration path required for local Worker integration |
| `SLAX_ENV` | Optional, defaults to `development` | `development`, `preview`, `beta` or `production` |

See `env.schema.ts` for other optional fields. Never put server secrets in frontend public configuration.

## Create a Google OAuth client ID

Google login requires a Web application OAuth client ID:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Open **APIs & Services → OAuth consent screen** and complete the application name, support email and required scopes.
3. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Select **Web application**.
5. Add `PUBLIC_BASE_URL`, such as `http://localhost:3000`, to **Authorized JavaScript origins**.
6. Add `${AUTH_BASE_URL}/auth`, such as `http://localhost:3000/auth`, to **Authorized redirect URIs**.
7. Copy the generated **Client ID** into `GOOGLE_OAUTH_CLIENT_ID`.

Only the Client ID belongs in frontend configuration. The Client Secret is a server credential and must not be placed in `deploy/local/.env.web.example` or browser output.

## Backend boundary

`pnpm web -- dev` preserves the existing integration path: the API must have generated `deploy/local/.wrangler/state/v3`, and Web calls the local Worker through the `BACKEND` service binding in the generated `deploy/local/.generated/web/wrangler.toml`.
Nuxt prepare, type checks and builds do not require that backend path. This guide does not claim that login, bookmark synchronization or saving work without an API integration environment.

Do not start, install or modify the old frontend repository for this migration. Connect to an API integration environment only with configuration supplied by the developer. This work does not deploy Cloudflare resources or change production bindings.

## Checks without real services

The following placeholder values allow prepare, type checks, unit tests and builds without starting the API:

```sh
export SLAX_ENV=development
export PUBLIC_BASE_URL=http://localhost:3000
export AUTH_BASE_URL=http://localhost:3000
export SHARE_BASE_URL=http://localhost:3000
export DWEB_API_BASE_URL=http://localhost:8787
export COOKIE_DOMAIN=localhost
export COOKIE_TOKEN_NAME=slax_test
# Required Google OAuth Client ID; see the steps above.
export GOOGLE_OAUTH_CLIENT_ID=your-google-client-id
# Optional: leave empty to hide Apple login.
export APPLE_OAUTH_CLIENT_ID=
# Optional: leave empty to disable Turnstile.
export TURNSTILE_SITE_KEY=
```

These values do not start the API and cannot verify real login, synchronization or production deployment. A successful development-profile build does not verify production configuration.
A complete install still requires Node.js, pnpm and any native build tools required by the local platform; skipping install scripts is not a complete install.

## Verification order

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @apps/slax-reader-dweb type
pnpm --filter @slax-reader/selection typecheck
pnpm web -- typecheck
pnpm web -- test
pnpm web -- build
```

These checks use the existing Vitest suite. Passing tests and a build do not prove successful backend integration.

With local integration configuration available, run `pnpm web -- dev` and verify login, the bookmark list, articles, highlights and comments. Also check `/x/ext-bridge` together with the Extension. Use development test accounts only.

The `build` hook projects public API TOML data into `deploy/local/.generated/web/wrangler.toml`; it does not rewrite the tracked `apps/web/wrangler.toml`.

## Directory conventions

`open_docs` contains product content read by Nuxt Content and stays inside the app. `content.config.ts` also lists the app-local `docs/en` and `docs/zh` content roots, but those directories are not present in the current snapshot.
Long-form Web documentation lives in `docs/web` and is not treated as page content. Application dependencies belong in the app manifest, and workspace packages are linked by pnpm rather than copied from the old repository.

## Contributing to Web and Extension

You can participate without a local environment by reporting an issue or suggestion on GitHub, or by editing Markdown and translation files in the web editor. Include the location, environment, reproduction steps, expected result and actual result in a report, and remove account details, private articles, cookies and tokens.

For a small wording, translation or documentation change, use GitHub's editor, check the Markdown preview, and propose the change from a new branch. Larger multi-file changes should start with an Issue and follow the local workflow. Do not commit directly to `dev`, `beta` or `main`. Features, APIs and behavior changes require a reviewed OpenSpec proposal; documentation-only changes may use `OpenSpec: n/a`.

Translations live in `apps/web/i18n/locales` and `apps/extension/src/locales`. Preserve keys, placeholders, line breaks and JSON structure. Web uses placeholders such as `{username}`, while the Extension uses placeholders such as `$1`. Code changes should use an isolated worktree and should report the actual type checks, tests and builds run in the PR.
