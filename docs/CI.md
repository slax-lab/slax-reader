# CI scope selection

Application validation runs on pull requests, including promotion PRs. Each CI workflow first checks the complete PR merge-base/head diff with `tooling/ci-scope.mjs`. Detection checks out full history and needs no pnpm installation. Unrelated workflows can therefore appear with a small detection job, while their build and test jobs are skipped. Application suites do not run again solely because the PR merged into dev, beta, or main.

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
| Workflow sources | Root tooling and workflow contract tests, plus their directly affected suites |
| API deployment template/local infrastructure | API and root configuration tooling checks |
| Mobile deployment inputs | Mobile; no API suite solely due to the `deploy` directory |
| Ordinary Mobile guides/deployment README | No application compilation or bundling solely for prose |
| Mobile evidence and non-Markdown manifests | Mobile tests consuming those records, without an application bundle |
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

Frontend, API, Mobile, CLI, Tooling, and agent-config use `github.workflow` plus the PR number as their concurrency key with `cancel-in-progress: true`. A new push cancels older running or pending validation for that same PR and workflow; other PRs and workflows remain independent. CLI and Extension publication retain their non-canceling branch queues. Already-started runs created before this configuration existed are not retroactively placed in its concurrency groups.

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
