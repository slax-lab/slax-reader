# Proposal

## Why

The repository now has API, Web, and Extension setup flows, but preflight coverage is uneven: Web and Extension only report basic environment/dependency failures, while API local configuration, Docker, PostgreSQL, and PowerSync readiness are not surfaced consistently. The onboarding runbook also gives several different initialization sequences.

The change should make local readiness visible in one place, provide actionable recovery instructions, and establish one documented setup sequence for the whole monorepo.

## What Changes

- Extend `pnpm preflight` so API, Web, and Extension each have a complete module check covering configuration, workspace dependencies, framework-generated state, and any local integration prerequisites.
- Classify findings by their actual impact: startup blockers (`当前无法启动`), missing dependencies or configuration needed for working features (`可启动，但无法正常运行`), and passed local checks (`启动检查通过`). Print the status first, describe affected features, and retain non-zero exit status for both startup blockers and functionality failures. Optional disabled features remain informational.
- Keep preflight read-only. It may inspect files, execute version/health probes, and reuse API dev/setup validation through a read-only readiness probe, but it must not log in, create files, start containers, migrate databases, generate keys, or start Workers.
- Add a root `setup:all` orchestration script that runs API setup, Web setup, and Extension setup in order and stops on the first failure. This avoids pnpm's built-in `setup` command while keeping the repository workflow directly invokable as `pnpm setup:all`.
- Align the onboarding, root, API, Web, and Extension documentation around the same setup/preflight order, including the distinction between prerequisite checks and completed local runtime readiness.

- Harden the review verdict gate discovered during the requested CI simulation: require exactly one valid verdict and reject malformed or positive counts without integer overflow.

## Capabilities

### New Capabilities

- `repository-local-setup`: A canonical root setup workflow that initializes API, Web, and Extension in a deterministic order with failure propagation and clear completion criteria.

### Modified Capabilities

- `agentic-pr-review`: Fail closed when a review verdict is missing, duplicated, malformed, or has any positive Important finding count.

- `frontend-preflight`: Expand the root preflight contract from frontend-only checks to a read-only, actionable readiness report for API, Web, and Extension, while retaining the existing environment-file boundary and safe output rules.

## Impact

- Review workflow shared source, generated locks, and local verdict regression tests.
- Root scripts and tooling: `package.json`, `tooling/preflight.mjs`, new setup orchestration tooling, and their tests.
- API command surface: `apps/api/package.json`, API dispatcher/help text, setup tests, and setup shell documentation.
- Local development documentation: `README.md`, `docs/LOCAL-SETUP.md`, API development/setup guides, and Web/Extension development guides.
- No API routes, database schema, Worker behavior, or remote deployment semantics change. Preflight and root setup remain local operations; setup continues to keep Worker startup separate.
