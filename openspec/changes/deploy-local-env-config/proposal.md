# Proposal

## Why

The frontend environment files currently live inside each app, which makes the repository layout harder for non-programmers and third-party contributors to understand and makes root-level commands depend on app-specific conventions. A small, explicit deployment area can hold local Web and Extension configuration without adding more files to the repository root, while the existing `pnpm web -- ...` and `pnpm extension -- ...` entry points can load the right configuration automatically.

## What Changes

- Add `deploy/local_web/` and `deploy/local_extension/` as the public locations for local frontend configuration.
- Add an `.env.example` to each directory, with comments explaining required values, optional providers, and where to create the Google OAuth client ID.
- Make the root Web and Extension dispatchers load the matching deploy files before running the selected app command.
- For the development profile, support `.env` plus `.env.dev`; keep process environment variables as the highest-priority source and use the same resolution rules in preflight.
- Update preflight and frontend documentation to point contributors to the deploy directories, without reading or committing real secret files.
- Keep backend deployment configuration out of this change.
- Move the tracked frontend environment examples out of `apps/web` and `apps/extension` so there is one obvious onboarding location; existing app-local files remain an optional compatibility fallback when an app is invoked directly.

## Capabilities

### New Capabilities

- `frontend-local-environment`: Centralized, per-frontend deploy configuration loading and onboarding checks for Web and Extension commands.

### Modified Capabilities

- None.

## Impact

- Affects `tooling/run-app.mjs`, shared tooling for environment-file parsing, `tooling/preflight.mjs` and its tests, frontend environment loaders, `.gitignore`, frontend examples, and development documentation.
- Root Web and Extension commands gain a configuration-loading step; values are passed to the child process without printing them or mutating the parent shell.
- Contributors should create `deploy/local_web/.env` or `deploy/local_extension/.env` from the corresponding example before running frontend commands.
- No backend code, API contract, or external deployment configuration is changed.
