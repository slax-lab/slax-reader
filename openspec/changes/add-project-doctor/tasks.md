## 1. Setup check command

- [x] 1.1 Add the root `setup:check` and `test:setup-check` scripts.
- [x] 1.2 Implement runtime, workspace dependency, and app-local environment checks in `tooling/doctor.mjs`.
- [x] 1.3 Add unit tests for environment parsing, precedence, and validation.

## 2. Onboarding

- [x] 2.1 Document `pnpm run setup:check`, its app/profile options, and its backend boundary in the developer guides.
- [x] 2.2 Update the root repository map to include all current shared frontend packages.

## 3. Validation

- [x] 3.1 Run the setup check unit tests and the command help output.
- [x] 3.2 Run OpenSpec strict validation and `git diff --check`.
