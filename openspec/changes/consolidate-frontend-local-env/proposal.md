# Proposal: Consolidate frontend local environment files into `deploy/local`

## Why

Web and Extension each own a separate deploy directory (`deploy/local_web`, `deploy/local_extension`) alongside the API's `deploy/local`. Contributors setting up all three apps end up managing three sibling `deploy/local*` directories that differ only by suffix, and the split predates the API's own `deploy/local` convention that this repo has since standardized on for generated config, Wrangler state, and `api.toml`.

The team decided to fold Web and Extension configuration into the same `deploy/local` directory the API already uses, distinguishing apps by filename instead of by directory: `.env.web` / `.env.web.dev` / `.env.web.example` for Web, `.env.extension` / `.env.extension.dev` / `.env.extension.example` for Extension. This matches the API's own `.env` / `.env.dev` files living in the same directory, so all three apps' local configuration lives in one place.

## What Changes

- `tooling/env-files.mjs`: `DEPLOY_DIRECTORIES` maps both `web` and `extension` to `deploy/local` (matching the API's existing directory). File name resolution changes from `.env` / `.env.<profile>` to `.env.<app>` / `.env.<app>.<profile>`, so the two apps' files coexist in the same directory without collision. The API's own `deploy/local/.env` / `.env.dev` are untouched — they are loaded by an unrelated mechanism in `apps/api/script/`.
- `apps/web/config/backend-binding.ts`: `GENERATED_DIR` (the directory `ssr:dev` writes its generated `wrangler.toml` into) moves from `deploy/local_web/.generated` to `deploy/local/.generated/web`, alongside the API's other generated artifacts under `deploy/local/.generated`. The tracked, static `apps/web/wrangler.toml` deploy template is unaffected.
- `deploy/local_web/.env.example` and `deploy/local_extension/.env.example` move to `deploy/local/.env.web.example` and `deploy/local/.env.extension.example` (content unchanged apart from self-referencing path comments). The `deploy/local_web/` and `deploy/local_extension/` directories are removed.
- `.gitignore`: replaces the `local_web`/`local_extension` ignore entries with ignore rules for `deploy/local/.env.web`, `.env.web.*`, `.env.extension`, `.env.extension.*` (mirroring the existing API `.env`/`.env.dev` pattern), while keeping the new `.example` files tracked.
- Tests (`tooling/env-files.test.mjs`, `tooling/preflight.test.mjs`, `tooling/app-command.test.mjs`, `tooling/wrangler-command.test.mjs`) and docs (`README.md`, `docs/web/development.md`(+`_CN`), `docs/extension/development.md`(+`_CN`), `apps/web/README.md`(+`_CN`), `apps/extension/README.md`(+`_CN`)) and CI path filters (`.github/workflows/frontend-ci.yml`) are updated to match.

## Impact

- Affected capability: `frontend-local-environment` (this change carries `MODIFIED Requirement`s against the living spec archived from `deploy-local-env-config`)
- Affected code: `tooling/env-files.mjs`, `apps/web/config/backend-binding.ts`, `deploy/local_web/*` → `deploy/local/*`, `deploy/local_extension/*` → `deploy/local/*`, `.gitignore`, associated tests, docs, and CI path filters
- No change to the API's existing `deploy/local/.env` / `.env.dev` loading, `apps/web/wrangler.toml`, or any product-observable behavior — this is local developer tooling only
- Breaking for existing local checkouts: any contributor with a real `deploy/local_web/.env` or `deploy/local_extension/.env` must move its contents to the new filenames after this change lands (documented in the updated setup guides)
