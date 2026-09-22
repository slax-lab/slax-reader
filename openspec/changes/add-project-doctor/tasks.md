## 1. Preflight command

- [x] 1.1 Add the root `preflight` and `test:preflight` scripts.
- [x] 1.2 Implement runtime, workspace dependency, and app-local environment checks in `tooling/preflight.mjs`.
- [x] 1.3 Add unit tests for environment parsing, precedence, and validation.
- [x] 1.4 Rename the public setup check to `preflight` and verify no old command or tooling filename remains in active documentation.
- [x] 1.5 Add readable section hierarchy and optional terminal colors; verify colored and plain-text output paths.
- [x] 1.6 Add app-local environment file guidance when no variables are configured; verify the message names both the target file and `.env.example`.

## 2. Onboarding

- [x] 2.1 Document `pnpm preflight`, its app/profile options, and its backend boundary in the developer guides.
- [x] 2.2 Update the root repository map to include all current shared frontend packages.

## 3. Validation

- [x] 3.1 Run the preflight unit tests and the command help output.
- [x] 3.2 Run OpenSpec strict validation and `git diff --check`.
