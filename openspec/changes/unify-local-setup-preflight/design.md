# Design

## Context

See `proposal.md` for the motivation and user-facing scope. The current preflight has shared runtime and environment helpers, but its Web and Extension checks stop at required variables and installed links. API setup already contains authoritative validation for `api.toml`, local Worker variables, Hyperdrive loopback targets, PowerSync signing-key derivation, and Docker availability. The API setup shell owns database initialization, migrations, code generation, and PowerSync startup. Web and Extension setup scripts already delegate to their narrower framework preparation commands.

The design preserves three boundaries: preflight is read-only, setup mutates only documented local development state, and application startup remains separate. It also uses a root command name that is not reserved by pnpm.

## Goals / Non-Goals

**Goals:**

- Give API, Web, and Extension the same status-first, actionable readiness report.
- Distinguish startup blockers from missing infrastructure or feature configuration that permits startup but prevents normal operation.
- Reuse existing environment loaders and API validation rules instead of creating weaker interpretations.
- Detect Docker and local service readiness without starting or changing containers.
- Make the root setup sequence deterministic, repeatable, and independently testable.
- Keep remediation messages useful while never echoing secret values or credentials.

**Non-Goals:**

- Preflight will not log in, run migrations, generate keys, start containers, or start Workers/dev servers.
- Root setup will not start development servers or provision remote Cloudflare resources.
- API routes, Worker bindings, database schemas, migration contents, and application runtime behavior remain unchanged.
- The root command will not use the reserved `pnpm setup`; it will be `pnpm setup:all`.

## Decisions

### 1. Use module adapters with three readiness states

Extend `tooling/preflight.mjs` with a module adapter for each API, Web, and Extension. Shared runtime/dependency logic runs first; each adapter then defines its environment, generated-state, integration, and service checks. The default selection includes all three, while `--app api|web|extension` narrows the report.

Each finding carries an impact independent of its setup phase. Startup failures are red errors; functionality failures are amber warnings with an explicit impact tag. Ordinary reminders and optional disabled features do not affect readiness. Each module prints its status before its details, with startup blockers taking precedence:

- `当前无法启动`: unsupported runtime, missing workspace/CLI dependencies, unreadable configuration, invalid API binding configuration, missing Nuxt/WXT preparation, or missing imported API generated code.
- `可启动，但无法正常运行`: Docker/Compose/daemon unavailable, unhealthy PostgreSQL/PowerSync, missing D1 state, missing Worker signing/authentication secrets, or missing frontend login/API/cookie settings. Extension's PUBLIC_BASE_URL is a startup requirement because its offscreen entry evaluates a URL at module initialization.
- `启动检查通过`: all selected local startup and functionality checks passed. This is not a guarantee of cloud resources, active servers, OAuth credentials, or end-to-end integration.

Both startup and functionality failures return exit code 1. Only reminders/informational findings allow exit code 0. The footer separately counts startup blockers, functionality failures, and ordinary reminders. Under `--app all`, known API failures affect Web/Extension integration status and known Web failures affect Extension integration status. Narrow checks do not read unrelated modules just to determine peer readiness.

### 2. API checks reuse setup validation and inspect services read-only

The API adapter will:

1. Resolve `SLAX_API_CONFIG` and `SLAX_API_ENV` with the same precedence as API tooling.
2. Check the API workspace installation and `tsx`/dispatcher prerequisites.
3. Run a read-only API readiness probe through a captured child process when API dependencies are installed. It reuses dev configuration validation and setup development validation separately, returns only boolean results, and runs independently of Docker availability so an infrastructure failure cannot hide invalid startup configuration.
4. Probe `docker`, `docker compose version`, and `docker info` separately so the remediation distinguishes an absent executable, missing Compose plugin, and stopped daemon.
5. Inspect `deploy/local/dockerfile-local-pgsql.yaml` with `docker compose ... ps --all --format json` and classify `postgres`, `powersync`, and `powersync-api` as healthy, stopped, starting, or failed. A working daemon with no containers is an incomplete setup state.
6. Check the local D1 state and API generated output markers produced by setup when those markers are required for a ready local API. Missing state is reported, never repaired.

Invalid dev configuration or missing imported generated code produces `API 当前无法启动`. Missing runtime secrets, invalid signing keys, unavailable Docker, unhealthy services, absent D1 state, or failing local setup validation produce `API 可启动，但无法正常运行` when startup checks pass. Each diagnostic explains the affected initialization, authentication, database, or synchronization capability.

### 3. Web and Extension checks cover the complete local start contract

The Web adapter keeps the existing environment/profile precedence and validates all required values, workspace links, the Nuxt command, and `.nuxt/tsconfig.server.json` generated by setup. It also inspects the local API binding selection used for integration: selected `api.toml`, the required OSS binding, and generated Web Wrangler/state artifacts when local integration is requested. Missing dependencies, invalid environment-file syntax, invalid API bindings, or missing Nuxt preparation blocks Web startup. Missing frontend login/API/cookie settings or API integration state degrades functionality; an absent generated Wrangler projection is informational because dev regenerates it.

The Extension adapter validates all required values, workspace links, the WXT command, and `.wxt/tsconfig.json`. It checks that configured Web/API origins are syntactically valid and reports peer readiness as an integration note without making network requests. Missing dependencies, invalid environment-file syntax, missing WXT preparation, or an invalid PUBLIC_BASE_URL blocks Extension startup. Other missing frontend login/API/cookie settings degrade functionality.

Alternative considered: keep Web and Extension as environment-only checks. Rejected because a contributor can pass those checks while the first dev command still fails on missing generated framework state or local binding preparation.

### 4. Use status-first output and safe remediation catalogues

Remediation text comes from fixed, non-secret messages: copy the matching example, run `pnpm install --frozen-lockfile`, run `pnpm api -- config:init` for the public API template, run `pnpm api -- setup`, run `pnpm web -- setup`, run `pnpm extension -- setup`, or follow Docker's official installation page (`https://docs.docker.com/get-docker/`). Variable values, TOML values, key material, environment URLs, and captured child output are never printed.

Alternative considered: print raw setup-check output. Rejected because it mixes formatting, can disclose operator input through future error changes, and prevents consistent module status lines.

### 5. Preserve the API setup command and use `setup:all` at the root

Keep the backend's existing `pnpm api -- setup` command as the API setup entry point. The root `setup:all` script invokes `pnpm api -- setup`, `pnpm web -- setup`, and `pnpm extension -- setup` sequentially through the existing safe pnpm invocation helper. It forwards signals and child exit status, inherits output, and stops on the first failure. `pnpm setup:all` is directly available and does not collide with pnpm's built-in `setup` command.

Alternative considered: use a root `setup` script and document `pnpm run setup`. Rejected because the user wants a direct setup command and pnpm reserves that name for its own CLI behavior.

### 6. Treat documentation as one lifecycle

Update the English root/runbook/API/Web/Extension documentation to use:

1. `pnpm install --frozen-lockfile`
2. `pnpm preflight` for read-only diagnosis
3. prepare missing local files and system prerequisites
4. `pnpm setup:all` for API → Web → Extension initialization
5. `pnpm preflight` again to verify readiness
6. start `pnpm api -- dev`, `pnpm web -- dev`, and `pnpm extension -- dev` separately

The API guide describes `setup --check` as read-only and keeps the existing API command name. Web and Extension guides state that setup regenerates `.nuxt`/`.wxt` after a fresh install or cache deletion.

### 7. Validate review verdicts without fail-open fallbacks

The requested local CI simulation exercises the actual shared review-verdict
shell step with synthetic agent output. Require exactly one verdict, a decimal
non-negative Important count, and a nonblank string summary. Detect positive
counts by their decimal digits rather than shell integer conversion, so a count
larger than the shell integer range cannot bypass the gate. Recompile both
workflow locks from the shared source and retain regression cases for missing,
duplicate, malformed, zero, positive, and oversized counts. This implements the
existing fail-closed intent; review triggers and publication remain unchanged.

## Risks / Trade-offs

- **[Risk]** Docker Compose output differs between Docker versions. → Parse the documented JSON format with a tolerant single-object/line-array reader and fall back to a clear inspection diagnostic without treating an unknown state as healthy.
- **[Risk]** Running the API readiness probe from preflight can fail when API dependencies are not installed. → Check the workspace marker first and show the install remediation; do not invoke a missing checker.
- **[Risk]** A healthy container does not prove migrations or application semantics. → Keep wording to local readiness and retain setup's migration and acceptance tests.
- **[Risk]** Framework-generated files become stale after dependency/configuration changes. → Report their presence as preparation state and make setup repeatable; do not claim freshness beyond the framework command's exit status.
- **[Risk]** The API setup command is supplied by the backend workstream. → Keep root orchestration and preflight remediation aligned with `setup`.
- **[Risk]** Root setup is interactive because API setup may run Wrangler login. → Preserve inherited stdio, document browser authorization, and stop immediately on cancellation or failure.

## Migration Plan

1. Implement and test the root `setup:all` orchestrator using the existing API setup command.
2. Update preflight and fixtures for all three module adapters, Docker/service probes, generated-state checks, and output redaction.
3. Update all tracked documentation and command references.
4. Run focused tooling/API tests, then `openspec validate --all --strict` and the required local pre-push review.
5. Rollback is a code-only revert; local configuration, databases, containers, and generated files remain untouched.
