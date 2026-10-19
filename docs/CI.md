# CI scope selection

Application validation runs on pull requests, including promotion PRs, and through independent daily full validation on dev. Each PR CI workflow first checks the complete PR merge-base/head diff with `tooling/ci-scope.mjs`. Detection checks out full history and needs no pnpm installation. Unrelated workflows can therefore appear with a small detection job, while their build and test jobs are skipped. Application suites do not run again solely because the PR merged into dev, beta, or main; the separate Mobile EAS release gate is the only exception and runs only after a committed Mobile build-number increase.

The detector uses the PR's actual base branch and includes earlier PR commits, removed files, and both sides of a rename. It does not depend on GitHub's limited path-filter file window. Missing revisions, shallow history, and failed comparisons fail visibly rather than return an empty selection. The job summary lists selected and skipped scopes; detector output records the input paths that selected each scope.

## Check ownership

| Inputs | Validation |
| --- | --- |
| Web implementation/config/tests | Web typecheck and tests, shared type prerequisites, icon checks |
| Extension implementation/config/tests | Extension compile and tests, shared type prerequisites, controlled release-tooling checks |
| API implementation/config/tests | Generation, lint, typecheck, tests, offline Worker build |
| Mobile implementation/config/tests | Mobile checks and JavaScript bundle |
| CLI implementation/config/tests | CLI typecheck, tests, and package smoke on Node 22.22.2 and 24.15.0; CLI tooling checks |
| `packages/contracts/**` | All five application consumers |
| Shared frontend packages | Web and Extension |
| Unclassified shared workspace packages | Conservative coverage of all application consumers |
| App root dispatcher | That app and relevant root tooling tests |
| `tooling/run-app.mjs`, `tooling/env-files.*` | Web, Extension, root tooling tests |
| `tooling/pnpm-command.mjs` | All dispatcher consumers and tooling checks |
| CLI release tooling or workflow | Controlled CLI release tests, without Web/Extension application suites |
| Extension release tooling, ZIP inspector, or workflow | Controlled Extension release tests, without Web/Extension application suites |
| `apps/web/env.schema.ts` | Web and root tooling checks, plus Extension release tests that consume the shared schema |
| Workflow sources | Root tooling and workflow contract tests, plus their directly affected suites |
| API deployment template/local infrastructure | API and root configuration tooling checks |
| Mobile deployment inputs | Mobile; no API suite solely due to the `deploy` directory |
| Ordinary Mobile guides/deployment README | No application compilation or bundling solely for prose |
| Mobile evidence and non-Markdown manifests | Real ledger/source identity and referenced-artifact validation through `verify-baseline.mjs`, plus Mobile tests, without an application bundle |
| Design references | Design provenance and icon provenance checks |
| Icon validation tools | Icon validation and their tooling tests |
| Root manifest, shared lockfile, workspace configuration, `.npmrc` | Conservative full validation |
| CI detector, detector tests, composite detection action | All scopes, to verify selection-policy changes |

Documentation is not excluded merely by extension. Web Markdown content can be runtime input, and Mobile evidence includes Markdown files. Unknown application inputs remain conservative. The exact policy and its regression matrix live in `tooling/ci-scope.mjs` and `tooling/ci-scope.test.mjs`.

Root dependency files intentionally retain broad coverage. This implementation does not infer individual dependency graphs from lockfile edits, select individual unit tests, or reuse validation across different PR heads.

## Required configuration check

`agent-config drift check` remains present on every PR. Its detector runs inside that job so a detection error fails the required context directly. It installs dependencies only if rulesync, OpenSpec, or gh-aw validation is selected:

- Rulesync sources, generated agent paths, and toolchain inputs select rulesync checks.
- OpenSpec artifacts/configuration and toolchain inputs select strict OpenSpec validation.
- Agentic workflow Markdown/imports, compiled locks, actions lock/configuration, pinned setup, and drift tooling select the full pinned gh-aw compilation with strict validation and orphan purging.

Do not add a workflow-level `paths` filter to this required check. A workflow skipped by such a filter can leave a required context pending. Internal conditional steps complete the job normally when no configuration checks apply. A selected validation failure still fails the job.

AI review, its pause control, `PR review gate`, and the watchdog retain their separate policies. CI cancellation is scoped to the same workflow and PR; newer heads cancel obsolete read-only validation without canceling releases or deployments.

Frontend, API, Mobile, CLI, Tooling, and agent-config use the caller workflow name, a distinct suite identity, and the PR number (or run ID outside PRs) as their concurrency key with `cancel-in-progress: true`. A new push cancels older running or pending validation for that same PR and workflow; other PRs and workflows remain independent. The suite identity prevents reusable workflows sharing the Full CI caller from canceling one another. CLI and Extension publication retain their non-canceling branch queues. Already-started runs created before this configuration existed are not retroactively placed in its concurrency groups.

## Daily full validation

`full-ci.yml` runs every day at 04:23 Asia/Shanghai (20:23 UTC the previous day), after this workflow is merged into dev. GitHub schedules run from the default branch, currently dev, and may be delayed under load. The workflow requires dev explicitly; keep that default-branch assumption in mind if repository settings change.

The Full CI workflow also supports Actions **Run workflow**, selecting **dev**, or `gh workflow run full-ci.yml --ref dev`. A manual run targeting another ref fails its source guard with an explicit error.

Full CI calls the six existing validation workflows with `full_validation: true`. It skips scope detection entirely and runs Web, Extension, API, Mobile, both CLI Node versions, all root tooling suites, design/icon validation, real Mobile evidence validation, rulesync, strict OpenSpec validation, and full pinned gh-aw compilation with orphan detection. Standalone icon/evidence jobs are unnecessary because full Web and Mobile validation already includes them. A stale path rule cannot suppress these checks, even if every scope output would be false.

Results and failures are visible in Actions. Daily and manual full runs serialize by ref without canceling an executing run; their child suites remain independent of each other and of PR validation. This workflow has read-only repository permissions and does not call deployment, publication, or AI review. Native Mobile builds remain outside the existing CI suite; the separate EAS cloud trigger below submits a build to EAS without running native build steps on a GitHub runner. No extra notification channel is configured.

## Mobile EAS cloud build

`mobile-eas-build.yml` runs only for pushes to `dev`. `tooling/mobile-eas-release.mjs` compares `apps/mobile/package.json` with the pushed-before commit and requires a higher `buildNumber`, a consistent `version` and `previousBuildNumber`, `appVersionSource: local`, the `production` EAS environment, the `SlaxShare` app extensions declaration, and `.easignore` rules that keep `apps/mobile/tests` and `apps/mobile/fixtures` in the archive. When the preflight passes, the workflow calls the Mobile CI reusable suite; only after that succeeds does it trigger `eas build --platform ios --profile production --non-interactive --no-wait` with the repository `EXPO_TOKEN` secret. The trigger exits after submission; EAS performs the build and reads its environment/file secrets and credentials. Store submission and TestFlight publication remain separate authorized operations. Re-running the workflow for the same version submits another EAS build.

## Release verification

API/Web deployment and CLI release workflows keep their own release-specific builds, immutable-source guards, artifact verification, credentials, and serialization. Removing repeated application CI does not remove those checks. CLI release detection still evaluates every protected-branch push and skips unrelated merges or unchanged CLI versions.

See [CLI releases](cli/RELEASE.md) for CLI-scoped descriptions and the distinction between its installable package and GitHub's repository source downloads.

## Local verification

Run from the repository root:

```bash
pnpm test:ci
pnpm test:preflight
pnpm test:cli-tooling
pnpm test:extension-tooling
pnpm exec openspec validate --all --strict
```

The workflow tests check actual conditions and required-status wiring. Controlled release tests exercise publication outcomes without creating public tags, GitHub Releases, or npm versions. Native Mobile job removal is owned by the previously merged Mobile work; this change preserves its check-and-JavaScript-bundle configuration.
