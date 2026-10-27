# Proposal

## Why

The command-line client still lives in `slax-lab/slax-reader-cli`, while `apps/cli` in this monorepo is only a placeholder. Moving the existing client into the shared workspace removes a separate maintenance boundary and makes its build, packaging, documentation and compatibility checks part of the same development workflow as the API it consumes.

## What Changes

- Import the standalone CLI snapshot at `9697ec2949049d2e7ef0258cd7b9b6df2142007a` into `apps/cli`, including source, build configuration, public agent skill and usage documentation. Retain source provenance and MIT licensing; do not import its Git metadata, dependency tree, build outputs or independent lockfile.
- Preserve the npm identity `@slax-lab/reader-cli`, executable `reader-cli`, existing command/JSON contracts, API-key configuration namespace and upgrade behavior. The migration itself does not publish or bump the existing `1.0.0` version.
- Integrate dependencies into the root pnpm lockfile and expose `pnpm cli -- <script>` for build, typecheck, test, development and execution of the built CLI. The CLI must not require API/Web deployment configuration or startup.
- Consume existing compatible shared HTTP/request types without changing the backend wire contract or shipping a private workspace runtime dependency.
- Move repository/documentation links and public skill synchronization to the monorepo, explicitly selecting only the public `slax-reader` skill. Keep install and upgrade recovery hints aligned with that source.
- Add focused pull-request CI, isolated executable/API smoke tests, and a packed-artifact consumer check. Do not repeat full CLI validation on post-merge branch pushes or release tags; release builds explicitly and retains only release guards and an exact-archive installation smoke check.
- Add `.github/workflows/cli-release.yml`: pushing a stable `cli-v<version>` tag for a commit already on `main` automatically validates, publishes the tested package to npm through OIDC Trusted Publishing, and creates a GitHub Release in `slax-lab/slax-reader` containing the identical `.tgz` and SHA-256 checksum. Tags must match the package version; prereleases are rejected. Safe retries verify existing package/asset identity before resuming.
- Document the one-time npm trusted publisher authorization and built-in GitHub token permissions. No user-supplied Actions secret is required; creating a real release tag and publishing during this implementation remain out of scope.
- **BREAKING (runtime metadata):** replace the inaccurate Node.js 18 support claim with the monorepo-supported Node range (`^22.22.2 || ^24.15.0 || >=26.0.0`). Do not downgrade modern upstream dependencies to preserve the old claim.

## Capabilities

### New Capabilities

- `reader-cli`: a standalone-installable Slax Reader CLI maintained within the monorepo, including command compatibility, isolated developer workflows, packaging and public skill lifecycle.

### Modified Capabilities

None. Existing frontend setup/preflight, release branching and API capabilities remain unchanged.

## Impact

- Application: `apps/cli/**` replaces the placeholder with the migrated CLI; no Web, Extension, mobile or backend runtime changes.
- Tooling: root `package.json`, `pnpm-lock.yaml`, `tooling/cli.mjs`, focused Node tests and `.github/workflows/cli-ci.yml`.
- Documentation: root `README.md`, `docs/LOCAL-SETUP.md`, `docs/cli/**`, CLI READMEs, license/provenance notices, and `.rulesync/rules/overview.md` with generated guidance refreshed through `pnpm agent:sync`.
- Types: reuse compatible exports from `packages/contracts`; CLI-specific rendering and legacy response views remain local.
- Execution: work occurs only on `feat/migrate-reader-cli` in `.worktrees/migrate-reader-cli`, based on `origin/dev`; the main checkout and its unpushed mobile commit remain untouched.

## Non-goals

No new CLI commands or API features, authentication storage migration, telemetry-policy changes, global CLI/agent installation on the developer's machine, production account mutations, triggering a real npm publication during implementation, remote legacy-repository changes, Git history rewrite, automatic promotion/merge, or changes to existing setup/preflight module semantics.
