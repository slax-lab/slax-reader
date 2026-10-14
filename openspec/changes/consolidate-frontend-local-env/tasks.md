# Tasks

## Core loader

- [x] 1.1 Update `tooling/env-files.mjs`: `DEPLOY_DIRECTORIES.web` and `.extension` both resolve to `deploy/local`; `profileFileName`/`environmentFileNames` take an `appName` and produce `.env.<app>` / `.env.<app>.<profile>`
- [x] 1.2 Update `apps/web/config/backend-binding.ts`: `GENERATED_DIR` → `deploy/local/.generated/web`
- [x] 1.3 Update `tooling/env-files.test.mjs` for the new directory/filename scheme, including a case proving Web and Extension files coexist in `deploy/local` without collision

## Example files and ignore rules

- [x] 2.1 Move `deploy/local_web/.env.example` → `deploy/local/.env.web.example`; `deploy/local_extension/.env.example` → `deploy/local/.env.extension.example`; update self-referencing path comments inside each
- [x] 2.2 Remove `deploy/local_web/` and `deploy/local_extension/` directories
- [x] 2.3 Update `.gitignore`: remove the now-redundant `local_web`/`local_extension` generated-dir ignore rules (the blanket `deploy/*/.env.*` and `deploy/local/.generated/` rules already cover the new paths) and add `!deploy/local/.env.web.example` / `!deploy/local/.env.extension.example` exceptions

## Tests

- [x] 3.1 Update `tooling/preflight.test.mjs` fixtures and assertions for the new paths/filenames
- [x] 3.2 Update `tooling/app-command.test.mjs` fixtures and assertions
- [x] 3.3 Update `tooling/wrangler-command.test.mjs` fixtures and assertions (including the `--cwd`-based generated dir path)

## Docs and CI

- [x] 4.1 Update `README.md`, `docs/web/development.md` + `_CN`, `docs/extension/development.md` + `_CN`, `apps/web/README.md` + `_CN`, `apps/extension/README.md` + `_CN`
- [x] 4.2 Update `.github/workflows/frontend-ci.yml` path filters

## Spec deltas

- [x] 6.1 Add a `MODIFIED Requirements` delta for `frontend-preflight` (the "No app environment is configured" and "Preflight follows the existing environment boundary" requirements still named `deploy/local_web`/`deploy/local_extension`)

## Verification

- [x] 5.1 `node --test tooling/*.test.mjs`
- [x] 5.2 `pnpm web -- test`, `pnpm web -- typecheck`, `pnpm web -- build`
- [x] 5.3 Manually run `pnpm web -- ssr:dev` and `pnpm extension -- dev` end to end with real `.env.web`/`.env.extension` files
- [x] 5.4 `openspec validate --all --strict`
