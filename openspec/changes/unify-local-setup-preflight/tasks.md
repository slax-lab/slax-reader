# Tasks

## 1. Use the existing API setup command

- [x] 1.1 Keep the backend's existing `pnpm api -- setup` command as the API setup entry point and align the root orchestration, preflight remediation, and documentation with it.
- [x] 1.2 Preserve API setup's read-only `--check`, failure propagation, signal handling, and local setup order while adding the root `setup:all` workflow.

## 2. Root setup:all orchestration

- [x] 2.1 Add a root `setup:all` package script and a sequential dispatcher that invokes API, Web, and Extension setup through the existing safe pnpm invocation helper; verify a fixture records the exact order and stops at the first non-zero child status.
- [x] 2.2 Cover signal forwarding, exit-code preservation, and missing workspace commands; verify dispatcher tests pass and `pnpm setup:all --help` reaches the repository script without colliding with pnpm's built-in commands.

## 3. Complete module preflight

- [x] 3.1 Refactor preflight module metadata and status rendering so API, Web, and Extension each print a status-first heading and complete readiness summary; verify plain-text and color-controlled output contains no ANSI escapes or secret values.
- [x] 3.2 Add API configuration and runtime validation using the existing `SLAX_API_CONFIG`/`SLAX_API_ENV` boundary and shared API dev/setup validators; verify missing files, invalid Worker variables, invalid RSA JWKs, and remote database targets produce actionable startup or functionality diagnostics without exposing contents.
- [x] 3.3 Add Docker/Compose/daemon probes and read-only Compose service-state inspection for PostgreSQL, PowerSync, and PowerSync API; verify absent Docker, stopped daemon, missing containers, unhealthy services, and healthy services map to the specified status text and remediation commands without starting or mutating containers.
- [x] 3.4 Add API workspace/generated-state checks and remediation hints for `pnpm install --frozen-lockfile`, `pnpm api -- config:init`, `pnpm api -- setup`, and the official Docker installation page; verify each hint is selected for its corresponding fixture and no environment value is printed.
- [x] 3.5 Add complete Web checks for environment/profile validity, workspace links, Nuxt CLI, `.nuxt` generated state, and local API binding readiness; verify missing configuration, missing preparation, and ready fixtures receive distinct status and remediation output.
- [x] 3.6 Add complete Extension checks for environment/profile validity, workspace links, WXT CLI, `.wxt` generated state, and Web/API integration prerequisites; verify missing configuration, missing preparation, and ready fixtures receive distinct status and remediation output.
- [x] 3.7 Extend preflight tests for module filtering, environment/profile precedence, all three module readiness states, API setup prerequisites versus completed readiness, Docker probe parsing, and regression coverage for existing Web/Extension checks; verify `pnpm test:preflight` passes.

## 4. Documentation alignment

- [x] 4.1 Update the root README and `docs/LOCAL-SETUP.md` to document `pnpm preflight` → `pnpm setup:all` → separate dev commands, the API-first order, repeatability, and the module status/remediation model; verify every command is copy-pasteable from the repository root.
- [x] 4.2 Update API English/setup documentation and maintained API-language references with the existing `setup` command, explain `setup --check`, Docker/PostgreSQL/PowerSync prerequisites, and retain a compatibility note for aliases; verify repository-wide command references are intentional.
- [x] 4.3 Update Web and Extension development guides with first-run setup, cache-removal rerun rules, and the boundary between setup and `dev`; verify both guides link to the shared lifecycle and use `pnpm web -- setup`/`pnpm extension -- setup`.

## 5. Validation and review

- [x] 5.1 Run the focused tooling/API tests plus the repository's relevant type, lint, and documentation checks; record any environment-dependent checks that cannot run without operator files or Docker.
- [x] 5.2 Run `pnpm exec openspec validate --all --strict` and the three-pass local pre-push review required by `REVIEW.md`; resolve all Important findings before presenting the implementation for review.

- [x] 5.3 Simulate the shared CI verdict step, fix malformed-verdict and integer-overflow fail-open paths, add regression cases, and regenerate workflow locks.

## 6. Distinguish startup from working functionality

- [x] 6.1 Classify startup blockers and functionality failures independently of setup phase, explain affected features, preserve non-zero readiness exit status, and render a status-first report with separate counts.
- [x] 6.2 Keep API configuration validation independent of Docker and runtime-secret availability; reuse dev/setup validators with safe structured results, and cover combined failure cases.
- [x] 6.3 Update status documentation and spec scenarios; run focused tooling/API regression tests, strict spec validation, and Bugs/Security/Compliance review.
