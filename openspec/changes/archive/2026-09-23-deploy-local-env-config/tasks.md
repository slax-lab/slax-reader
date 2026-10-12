# Tasks

## 1. Shared environment loading

- [x] 1.1 Add `tooling/env-files.mjs` with deploy directory mapping, `.env` plus profile filename resolution (including development `.env.dev`), safe parsing, precedence, and malformed-file errors; verify focused unit tests cover base/profile/process precedence and missing or invalid files.
- [x] 1.2 Integrate the shared loader into `tooling/run-app.mjs` and the Web/Extension wrappers, passing a child-only environment and preserving help, unknown-command, and exit-status behavior; verify dispatcher tests and a dry-run or fixture invocation show the selected app receives only its own deploy variables.

## 2. Deploy configuration and onboarding

- [x] 2.1 Add `deploy/local_web/.env.example` and `deploy/local_extension/.env.example` with the current variable schemas, required/optional markers, Google OAuth creation steps, and no real secrets; verify both examples are tracked and parse successfully.
- [x] 2.2 Remove the duplicate tracked app examples, adjust ignore rules if needed, and update all Web/Extension/contributor documentation to copy from deploy paths and explain `.env.dev`; verify a repository search has no stale setup instructions pointing to `apps/web/.env` or `apps/extension/.env`.
- [x] 2.3 Keep the existing app-local loaders as direct-invocation fallbacks and document the root dispatcher as the supported onboarding path; verify app configuration code still parses and type-checks without changing the backend boundary.

## 3. Preflight alignment

- [x] 3.1 Refactor `tooling/preflight.mjs` to use the shared deploy source resolution, update hints and root-`.env` warning text, and preserve required/optional checks including Google, Apple, and Turnstile; verify preflight tests cover deploy paths, profile aliases, and required/optional status.
- [x] 3.2 Update preflight fixtures/tests to read the deploy examples and ensure no environment value is printed; verify `pnpm preflight -- --no-color` reports actionable deploy paths with redacted output.

## 4. Validation and review

- [x] 4.1 Run focused Node tests, JavaScript/TypeScript syntax checks, and `git diff --check`; record any environment-dependent checks that cannot run without real values.
- [x] 4.2 Run `openspec validate --all --strict` and the three local review passes required by `REVIEW.md`; resolve Important findings before proposing the branch for merge.
