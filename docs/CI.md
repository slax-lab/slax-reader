# CI scope selection

Application validation runs on pull requests, including promotion PRs, and through independent daily full validation on dev. Each PR CI workflow first checks the complete PR merge-base/head diff with `tooling/ci-scope.mjs`. Detection checks out full history and needs no pnpm installation. Unrelated workflows can therefore appear with a small detection job, while their build and test jobs are skipped. Application suites do not run again solely because the PR merged into dev, beta, or main; the separate Mobile EAS release gate is the only exception and runs only after a committed Mobile build-number increase.

The detector uses the PR's actual base branch and includes earlier PR commits, removed files, and both sides of a rename. It does not depend on GitHub's limited path-filter file window. Missing revisions, shallow history, and failed comparisons fail visibly rather than return an empty selection. The job summary lists selected and skipped scopes; detector output records the input paths that selected each scope.

## Branch protection and required contexts

Every long-lived branch rejects direct pushes, force-pushes, and deletion, and administrator bypass actors are configured in `pull_request` mode — an administrator can merge an exceptional pull request, but a direct push stays rejected even for them. The branches gate different decisions, so their entry conditions and required contexts differ:

| Branch | Entry rule | Required contexts | Merge methods |
| --- | --- | --- | --- |
| `dev` | Any pull request | `agent-config drift check`, `PR review gate`, `Web CI gate`, `Extension CI gate`, `API CI gate`, `Mobile CI gate`, `CLI CI gate`, `Tooling CI gate` | merge, squash, rebase |
| `beta` | Head is `dev` or `hotfix/*` | `promotion integrity`, `Web CI gate`, `Extension CI gate`, `API CI gate`, `Mobile CI gate`, `CLI CI gate`, `Tooling CI gate` | merge commit only |
| `main` | Head is `beta` or `hotfix/*` | `promotion integrity` | merge commit only |

Each application CI workflow ends in a terminal gate job whose name is a ruleset-referenced contract: `Web CI gate` and `Extension CI gate` in `frontend-ci.yml`, `API CI gate` in `api-ci.yml`, `Mobile CI gate` in `mobile-ci.yml`, `CLI CI gate` in `cli-ci.yml`, and `Tooling CI gate` in `tooling-ci.yml`. The gate fails when any job in its suite failed and succeeds otherwise, so a suite that `ci-scope` skipped reports success and never blocks. `tooling/ci-workflow.test.mjs` asserts the exact gate names and their `if: always()` wiring; renaming one without updating the rulesets strands its required context at "Expected" and blocks the branch.

No approving review is required on `beta` or `main` for a promotion: the content was reviewed when it entered `dev`, and the administrator's merge is the designed release-decision act. A `hotfix/*` head never passed through `dev`, where reviews happen, so `promotion integrity` requires one approving review from an approver other than the hotfix author. On `main` the six suite gates are required through `promotion integrity` rather than as separate ruleset contexts; the promotion pull request still reports them because every pull request runs the application CI workflows.

## Promotion integrity check

`.github/workflows/promotion-gate.yml` runs on pull requests targeting `beta` and `main` and reports a single job, `promotion integrity`. The check fails closed on any shape it does not recognize and asserts:

- The head branch is an allowed source: `dev` or `hotfix/*` for `beta`; `beta` or `hotfix/*` for `main`.
- The six application CI gates are present and completed successfully on the pull request's head commit. A skipped suite gate counts as success only because `ci-scope` did not select that suite for the diff.
- For a `beta` → `main` promotion, the head commit also has successful conclusions from the beta-environment deployment workflows (`api-deploy`, `web-deploy`). A `hotfix/*` head skips this evidence, because it never entered `beta`.
- For a `hotfix/*` head, the pull request carries an approving review from someone other than its author; self-approval does not count. This lives in the gate rather than in the ruleset because rulesets cannot condition on a pull request's head branch — a ruleset-level review requirement would force reviews onto every promotion.

The workflow reads check runs and pull requests with the repository `GITHUB_TOKEN` (`checks: read`, `pull-requests: read`); it does not need the administration permission that drift detection uses.

## Ruleset state and drift detection

The expected ruleset state is codified in `.github/rulesets.expected.json`, and `tooling/rulesets.mjs` compares it with the live repository:

- `export` fetches the live rulesets, strips server-assigned identifiers and timestamps, normalizes key order, and writes the committed JSON.
- `check` diffs the live rulesets against the committed JSON, prints per-rule differences, and exits non-zero on drift.
- `apply` pushes the codified state to the GitHub API. Only a human administrator runs it locally with their own `gh` authentication; CI never applies rulesets, because mutation credentials in CI would turn any workflow compromise into a protection-removal primitive.

`.github/workflows/ruleset-drift.yml` runs `check` daily off-peak and on `workflow_dispatch`, authenticating with the `RULESETS_READ_TOKEN` secret — a fine-grained PAT with repository Administration read, which `GITHUB_TOKEN` cannot be granted. It opens or updates one tracking issue when the live state drifts from the codified state or when the token is missing or expired, so silent non-detection is bounded. The comparison is deliberately not a required check: drift pages a human decision and never blocks a pull request. An intentional protection change updates the codified JSON and applies the live rulesets as part of the same change; the next scheduled run then reports no drift.

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
| Design references | Design provenance and icon provenance checks |
| Icon validation tools | Icon validation and their tooling tests |
| Root manifest, shared lockfile, workspace configuration, `.npmrc` | Conservative full validation |
| CI detector, detector tests, composite detection action | All scopes, to verify selection-policy changes |

Documentation is not excluded merely by extension. Web Markdown content can be runtime input, and Mobile fixture Markdown can be runtime input. Unknown application inputs remain conservative. The exact policy and its regression matrix live in `tooling/ci-scope.mjs` and `tooling/ci-scope.test.mjs`.

Root dependency files intentionally retain broad coverage. This implementation does not infer individual dependency graphs from lockfile edits, select individual unit tests, or reuse validation across different PR heads.

## Required configuration check

`agent-config drift check` remains present on every PR and is a required context on `dev`. Its detector runs inside that job so a detection error fails the required context directly. It installs dependencies only if rulesync, OpenSpec, or gh-aw validation is selected:

- Rulesync sources, generated agent paths, and toolchain inputs select rulesync checks.
- OpenSpec artifacts/configuration and toolchain inputs select strict OpenSpec validation.
- Agentic workflow Markdown/imports, compiled locks, actions lock/configuration, pinned setup, and drift tooling select the full pinned gh-aw compilation with strict validation and orphan purging.

Do not add a workflow-level `paths` filter to this required check. A workflow skipped by such a filter can leave a required context pending. Internal conditional steps complete the job normally when no configuration checks apply. A selected validation failure still fails the job.

AI review, its pause control, `PR review gate`, and the watchdog retain their separate policies. CI cancellation is scoped to the same workflow and PR; newer heads cancel obsolete read-only validation without canceling releases or deployments.

Frontend, API, Mobile, CLI, Tooling, and agent-config use the caller workflow name, a distinct suite identity, and the PR number (or run ID outside PRs) as their concurrency key with `cancel-in-progress: true`. A new push cancels older running or pending validation for that same PR and workflow; other PRs and workflows remain independent. The suite identity prevents reusable workflows sharing the Full CI caller from canceling one another. CLI and Extension publication retain their non-canceling branch queues. Already-started runs created before this configuration existed are not retroactively placed in its concurrency groups.

## Review readiness label

`pr-review-gate.yml` also maintains a `ready-for-human-review` label on the pull request. It is a **fact**, not a gate: the required `PR review gate` status check remains the merge requirement, and the label changes nothing about merging.

- The gate adds the label when the status it reports for the pull request's **current head** is a passing one — a completed review without Important findings, or a run deliberately declined (paused reviews, budget stops). It removes the label when that status is a failure.
- The label only ever describes a pull request that can enter human review: the gate adds it only for an open pull request that is not a draft and whose head branch lives in this repository. A draft, a closed pull request (a `/review` run can finish after a merge) and a fork (whose read-only companion could never drop a stale label) never carry it, and any stale label is removed.
- A result about a superseded commit never touches the label. Only a verdict for the current head may change what the open pull request says about itself.
- `ready-for-review-label.yml` removes the label on any event that invalidates the verified state: a new head, a reopen, a draft conversion, a ready-for-review transition (which starts a new review) and a close. Removal failures are ignored; a missing label is the normal path.
- Both workflows carry `pull-requests: write`: a label on a pull request is written through the issues API, but only that permission authorises the write (`issues: write` alone returns `Resource not accessible by integration`, and the gate still needs it to create the label with its colour and description).
- `slax-notify-bridge` consumes the label's `labeled` event to announce the human review in Feishu, instead of announcing the creation-time review request that CODEOWNERS fires before the automated verdict exists. The label name is a cross-repository contract: changing it requires updating both workflows here and the bridge's per-repository policy.

## Daily full validation

`full-ci.yml` runs every day at 04:23 Asia/Shanghai (20:23 UTC the previous day), after this workflow is merged into dev. GitHub schedules run from the default branch, currently dev, and may be delayed under load. The workflow requires dev explicitly; keep that default-branch assumption in mind if repository settings change.

The Full CI workflow also supports Actions **Run workflow**, selecting **dev**, or `gh workflow run full-ci.yml --ref dev`. A manual run targeting another ref fails its source guard with an explicit error.

Full CI calls the six existing validation workflows with `full_validation: true`. It skips scope detection entirely and runs Web, Extension, API, Mobile, both CLI Node versions, all root tooling suites, design/icon validation, rulesync, strict OpenSpec validation, and full pinned gh-aw compilation with orphan detection. Standalone icon jobs are unnecessary because full Web and Mobile validation already includes them. A stale path rule cannot suppress these checks, even if every scope output would be false.

Results and failures are visible in Actions. Daily and manual full runs serialize by ref without canceling an executing run; their child suites remain independent of each other and of PR validation. This workflow has read-only repository permissions and does not call deployment, publication, or AI review. Native Mobile builds remain outside the existing CI suite; the separate EAS cloud trigger below submits a build to EAS without running native build steps on a GitHub runner. No extra notification channel is configured.

## Mobile EAS cloud builds

`mobile-eas-build.yml` runs only for pushes to `dev`. `tooling/mobile-eas-release.mjs` compares `apps/mobile/package.json` with the pushed-before commit and requires a higher `buildNumber`, a consistent `version` and `previousBuildNumber`, `appVersionSource: local`, the `production` EAS environment, the `SlaxShare` app extensions declaration, the Android platform, and `.easignore` rules that keep `apps/mobile/tests` and `apps/mobile/fixtures` in the archive. When the preflight passes, the workflow calls the Mobile CI reusable suite; only after that succeeds does it trigger `eas build --platform all --profile production --non-interactive --no-wait --auto-submit` with the repository `EXPO_TOKEN` secret. The trigger exits after the builds are queued; EAS performs both builds, reads its environment/file secrets and credentials, and submits each finished build with the `production` submit profile in `apps/mobile/eas.json` (iOS to TestFlight, Android to the Play internal track). The workflow-level concurrency key includes the commit SHA, so rapid successive pushes do not replace a pending bump; the EAS job key uses version/build to serialize the same release. The iOS build requires the iOS Firebase file secret and share-extension credentials; the Android build requires the Android Firebase file secret and Android signing credentials. Submission needs the App Store Connect API key and the Google Play service account key in EAS credentials; App Store review and Play promotion beyond the internal track remain manual. Re-running the workflow for the same version queues another pair of EAS builds and submissions, which the stores reject as duplicate build numbers. The behavior is specified by `mobile-eas-cloud-delivery`.

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
