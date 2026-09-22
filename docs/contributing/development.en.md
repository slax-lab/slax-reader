# Developer setup

[中文](development.md) · [Contributing](README.en.md) · [Documentation](../README.md)

Choose one app first: `apps/web` is the Nuxt reader, `apps/extension` is the WXT browser extension, and `apps/api` is the Cloudflare Workers API. You can work on either frontend app independently, but login and bookmark synchronization still need a working development API and configuration.

## Create a task worktree

Use Git, Node.js matching the app engines (`^22.22.2 || ^24.15.0 || >=26.0.0`), and the pinned pnpm 11.25.0. The root package's lower Node minimum is not sufficient for every frontend version. macOS is not required. Some scripts assume a POSIX shell; Windows contributors can use WSL2 and should check browser/backend paths. Clean installation has not yet been verified on all operating systems.

Without write access, fork and clone your copy, add the official repository as `upstream`, then create a task branch and worktree:

```sh
git remote add upstream https://github.com/slax-lab/slax-reader.git
git fetch upstream
git worktree add .worktrees/fix-reader-wording -b docs/fix-reader-wording --no-track upstream/dev
cd .worktrees/fix-reader-wording
```

Do not add `upstream` again if it already exists. If `origin` is the official repository, use `git fetch origin` and `origin/dev` instead. Replace the example task name with yours; keep the worktree directory and branch suffix identical. Edit in the task worktree, with one branch per task. See [AGENTS.md](../../AGENTS.md) for the repository rules.

**During migration:** until the frontend import reaches `dev`, that branch does not contain all files described here. Migration stages branch from the available local or published `feat/integrate-slax-reader-web-extension` branch and merge back into it. The final integration reaches `dev` through a PR. If the migration baseline has not been published, ask its maintainer for an available branch. Ordinary contributions target `dev` after migration.

## Install and configure

In the task worktree root, confirm `node --version` and `pnpm --version`, then run:

```sh
pnpm install --frozen-lockfile
```

After installation, run the preflight check to check the local runtime, workspace links, and required frontend environment variables:

```sh
pnpm preflight
```

It checks frontend setup only, never prints environment values, and does not start the backend. Use
`pnpm preflight --app web`, `pnpm preflight --app extension`, or `pnpm preflight --env preview` to narrow the check.
The root `pnpm web -- ...` and `pnpm extension -- ...` dispatchers read `.env` and the selected profile from `deploy/local_web` and `deploy/local_extension`; development uses `.env.dev`. A root `.env`
is not loaded automatically and the preflight check will warn about it.
Interactive terminals use colors to distinguish passing, warning, and blocking checks; use `pnpm preflight --no-color` for plain text.

Workspace installation may include tools from the other app; app-specific commands do not imply isolated dependency installation. Configuration schemas are in [Web](../../apps/web/env.schema.ts) and [Extension](../../apps/extension/env.schema.ts). Create your own configuration under `deploy/local_web` or `deploy/local_extension`, or supply process environment variables. Do not copy environment files from the old repository or commit credentials.

The root dispatchers load `.env` first and the profile file second; `.env.dev` is the development profile, profile values override base values, and process values take precedence.

```sh
cp deploy/local_web/.env.example deploy/local_web/.env
cp deploy/local_extension/.env.example deploy/local_extension/.env
```

The profile is selected from the process `SLAX_ENV`, then the app's deploy `.env`, with `development` as the default. Other supported profiles use `.env.preview`, `.env.beta`, or `.env.production`. A profile file cannot switch the selected profile itself. All root commands, including `dev`, `build`, type checks and tests, use this rule. `pnpm preflight --env preview` explicitly checks preview configuration.
Direct app package commands retain the previous app-local loader as a compatibility fallback; use the root dispatchers to load deploy configuration.

In `preflight`, `（必填）` means the variable must have a non-empty, valid value. `（可选）` means the related feature is disabled when the value is absent or empty and does not block frontend checks. Web requires `GOOGLE_OAUTH_CLIENT_ID`; `APPLE_OAUTH_CLIENT_ID` and `TURNSTILE_SITE_KEY` are optional. See the [Web development guide](../apps/web/development.md#创建-google-oauth-客户端-id) for the Google OAuth Client ID creation steps. `SLAX_API_CONFIG` / `deploy/local/api.toml` is required only when running `pnpm web -- dev` for a real backend integration; it does not block other frontend checks.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `SHARE_BASE_URL` | Both | Web, login and sharing origins |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | Both | Matching development session-cookie settings |
| `DWEB_API_BASE_URL` | Web | Backend API URL |
| `EXTENSIONS_API_BASE_URL` | Extension | Backend API URL |
| `GOOGLE_OAUTH_CLIENT_ID` | Web | Required Google Web OAuth client ID |
| `APPLE_OAUTH_CLIENT_ID` | Web | Optional Apple OAuth client ID; empty hides Apple login |
| `TURNSTILE_SITE_KEY` | Web | Optional Turnstile site key; empty disables Turnstile |
| `SLAX_API_CONFIG` / `deploy/local/api.toml` | Web dev server | Path to the API TOML configuration; defaults to deploy/local/api.toml |
| `SLAX_ENV` | Both | development (default), preview, beta or production |

App schemas define other optional fields. Client configuration goes into public bundles; do not put server credentials there.

For prepare, type checks, unit tests and a build without real services, you can use these placeholder values in a POSIX shell:

```sh
export SLAX_ENV=development
export PUBLIC_BASE_URL=http://localhost:3000
export AUTH_BASE_URL=http://localhost:3000
export SHARE_BASE_URL=http://localhost:3000
export DWEB_API_BASE_URL=http://localhost:8787
export EXTENSIONS_API_BASE_URL=http://localhost:8787
export COOKIE_DOMAIN=localhost
export COOKIE_TOKEN_NAME=slax_test
# Required Google OAuth Client ID; see the Web development guide.
export GOOGLE_OAUTH_CLIENT_ID=your-google-client-id
# Optional: leave empty to hide Apple login.
export APPLE_OAUTH_CLIENT_ID=
# Optional: leave empty to disable Turnstile.
export TURNSTILE_SITE_KEY=
```

These values do not start a backend or enable real login. They are for build/check validation, not production configuration.

## Run one app

Run these commands from the task worktree root:

| Operation | Web | Extension |
| --- | --- | --- |
| Development | `pnpm web -- dev` | `pnpm extension -- dev` |
| Type check | `pnpm web -- typecheck` | `pnpm extension -- typecheck` |
| Unit tests | `pnpm web -- test` | `pnpm extension -- test` |
| Build | `pnpm web -- build` | `pnpm extension -- build` |
| Package | — | `pnpm extension -- zip` |

Prepare Web types before its first checks:

```sh
pnpm --filter @apps/slax-reader-dweb type
```

Web development uses port 3000 and projects its Edge and OSS bindings from `SLAX_API_CONFIG` / `deploy/local/api.toml`, sharing `deploy/local/.wrangler/state/v3` with the API. Prepare, type checks, unit tests and builds can run with placeholder public configuration without a live API. The development server has no backend-free demo mode.

Extension development uses port 3001. Its dev command builds the shared selection engine and vendor assets; type checking and unit tests generate WXT types automatically. Load `apps/extension/build/chrome-mv3` using developer mode in `chrome://extensions` or `edge://extensions`; use `build/chrome-mv3-dev` for the dev server. Rebuilds of the ordinary build require a manual extension reload. Real features need Web's `/x/ext-bridge` and the backend.

Use matching hostnames, cookie settings and environment profiles. The existing development configuration normalizes `http://127.0.0.1:3000` Web/sharing URLs to `http://localhost:3000`, adjusting the cookie domain when applicable. See the app guides for [Web](../apps/web/development.md) and [Extension](../apps/extension/development.md) (Chinese).

## Check the affected area

| Change | Validation |
| --- | --- |
| Documentation | Check local links, Markdown preview and documented paths/commands; no app startup required |
| Translations | Validate JSON/placeholders and the affected app; disclose when UI verification needs help |
| App code | Its type check, relevant tests and build; manually verify changed interactions |
| Shared libraries | Check both apps; also run `pnpm --filter @slax-reader/selection typecheck` for the selection engine |
| OpenSpec artifacts | Run `pnpm exec openspec validate --all --strict` |

The [Web](../../apps/web/package.json) and [Extension](../../apps/extension/package.json) manifests are authoritative. Web's root type-check command covers the app. After prepare, also check server types when editing `apps/web/server`:

```sh
pnpm --filter @apps/slax-reader-dweb exec vue-tsc --noEmit -p .nuxt/tsconfig.server.json
```

There is currently no root `dev`, `test`, `lint` or `format` command. Existing configuration CI does not imply app tests ran; list actual results in the PR. Web binding metadata is projected to deploy/local_web/.generated and does not rewrite tracked wrangler.toml.

## Submit a change

Features, APIs and behavior fixes require an OpenSpec proposal reviewed by a human before implementation. Use `$openspec-propose` or the workflow in [AGENTS.md](../../AGENTS.md), keeping the task name, branch suffix and change-id aligned. Documentation, typos and implementation-only refactors may skip a proposal.

Read [REVIEW.md](../../REVIEW.md) and fill in the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md). Include the problem, resulting behavior, validation and limitations. Use `OpenSpec: <change-id>` for behavior changes, or `OpenSpec: n/a` for documentation-only work; this migration links to `integrate-slax-reader-web-extension`. Push your task branch and verify the PR base is `dev`, except for migration stages described above. Remove worktrees after merge; archive OpenSpec changes after merge following repository policy.

Generated files such as `AGENTS.md`, `CLAUDE.md`, `.agents` and `.codex` must not be edited by hand. Change `.rulesync` and run `pnpm agent:sync` for agent-rule changes. Keep app-only code in that app; libraries belong in `packages` when at least two apps use them.

## Common setup issues

| Symptom | Next step |
| --- | --- |
| Missing `.nuxt` / `.wxt` types | Run `pnpm --filter @apps/slax-reader-dweb type` or `pnpm --filter @apps/slax-reader-extensions type` |
| Missing selection `dist` | Run `pnpm --filter @slax-reader/selection build`, or use an app command that prepares it |
| Missing API path/local state | Run `pnpm api -- config:init` and prepare `deploy/local/api.toml`; without it, run checks that do not need the dev server |
| macOS install stops at `better-sqlite3` / Xcode license | Record Node/system versions and the error; see [remaining verification](../migrations/final-verification.md). Skipping scripts is not a full-install pass |
| Need a PR preview | No automatic PR preview deployment is configured; ask the author for a test environment or matching build |
