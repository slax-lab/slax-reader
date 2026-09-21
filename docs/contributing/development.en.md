# Developer setup

[中文](development.md) · [Contributing](README.en.md) · [Documentation](../README.md)

Choose one app first: `apps/web` is the Nuxt reader; `apps/extension` is the WXT browser extension. You can work on either without taking on backend migration, but login and bookmark synchronization still need a working development backend and configuration.

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

Workspace installation may include tools from the other app; app-specific commands do not imply isolated dependency installation. Configuration schemas are in [Web](../../apps/web/env.schema.ts) and [Extension](../../apps/extension/env.schema.ts). Create your own configuration under the relevant app or supply process environment variables. Do not copy environment files from the old repository or commit credentials.

The loaders read `.env`, `.env.<SLAX_ENV>`, then `.env.<SLAX_ENV>.local`. They do not enable dotenv's `override`: process values take precedence, then the first file to define a value wins. A `.local` suffix does not currently make a value override earlier files.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL`, `AUTH_BASE_URL`, `SHARE_BASE_URL` | Both | Web, login and sharing origins |
| `COOKIE_DOMAIN`, `COOKIE_TOKEN_NAME` | Both | Matching development session-cookie settings |
| `DWEB_API_BASE_URL` | Web | Backend API URL |
| `EXTENSIONS_API_BASE_URL` | Extension | Backend API URL |
| `GOOGLE_OAUTH_CLIENT_ID`, `APPLE_OAUTH_CLIENT_ID`, `TURNSTILE_SITE_KEY` | Web | Public client configuration |
| `SLAX_BACKEND_DIR` | Web dev server | Absolute path to a separately prepared backend checkout |
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
export GOOGLE_OAUTH_CLIENT_ID=
export APPLE_OAUTH_CLIENT_ID=
export TURNSTILE_SITE_KEY=
```

These values do not start a backend or enable real login. They are for build/check validation, not production configuration.

## Run one app

Run these commands from the task worktree root:

| Operation | Web | Extension |
| --- | --- | --- |
| Development | `pnpm dev:web` | `pnpm dev:extension` |
| Type check | `pnpm typecheck:web` | `pnpm typecheck:extension` |
| Unit tests | `pnpm test:web` | `pnpm test:extension` |
| Build | `pnpm build:web` | `pnpm build:extension` |
| Package | — | `pnpm zip:extension` |

Prepare Web types before its first checks:

```sh
pnpm --filter @apps/slax-reader-dweb type
```

Web development uses port 3000 and requires `SLAX_BACKEND_DIR` with existing `config/.wrangler/state/v3`. Prepare, type checks, unit tests and builds can run with placeholder public configuration without a live backend. The development server has no backend-free demo mode.

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

There is currently no root `dev`, `test`, `lint` or `format` command. Existing configuration CI does not imply app tests ran; list actual results in the PR. Web builds can update the service name in `wrangler.toml`; inspect the diff before committing.

## Submit a change

Features, APIs and behavior fixes require an OpenSpec proposal reviewed by a human before implementation. Use `$openspec-propose` or the workflow in [AGENTS.md](../../AGENTS.md), keeping the task name, branch suffix and change-id aligned. Documentation, typos and implementation-only refactors may skip a proposal.

Read [REVIEW.md](../../REVIEW.md) and fill in the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md). Include the problem, resulting behavior, validation and limitations. Use `OpenSpec: <change-id>` for behavior changes, or `OpenSpec: n/a` for documentation-only work; this migration links to `integrate-slax-reader-web-extension`. Push your task branch and verify the PR base is `dev`, except for migration stages described above. Remove worktrees after merge; archive OpenSpec changes after merge following repository policy.

Generated files such as `AGENTS.md`, `CLAUDE.md`, `.agents` and `.codex` must not be edited by hand. Change `.rulesync` and run `pnpm agent:sync` for agent-rule changes. Keep app-only code in that app; libraries belong in `packages` when at least two apps use them.

## Common setup issues

| Symptom | Next step |
| --- | --- |
| Missing `.nuxt` / `.wxt` types | Run `pnpm --filter @apps/slax-reader-dweb type` or `pnpm --filter @apps/slax-reader-extensions type` |
| Missing selection `dist` | Run `pnpm --filter @slax-reader/selection build`, or use an app command that prepares it |
| Missing backend path/local state | Prepare the external development backend; without it, run checks that do not need the dev server |
| macOS install stops at `better-sqlite3` / Xcode license | Record Node/system versions and the error; see [remaining verification](../migrations/final-verification.md). Skipping scripts is not a full-install pass |
| Need a PR preview | No automatic PR preview deployment is configured; ask the author for a test environment or matching build |
