# Design

## Context

See proposal.md — Why. Facts established while preparing the change:

- Both workflows already pin Node to exact patch releases (`22.22.2`, `24.15.0`), and the CLI matrix is rendered by `strategy.matrix.node`.
- `tooling/ci-workflow.test.mjs` asserts the CLI matrix contents verbatim and asserts the tooling release jobs' Node version, so the contract tests must move with the workflows.
- Both workflows end in a gate job (`CLI CI gate`, `Tooling CI gate`) that `needs:` every suite job and fails closed on any failed result; those names are required status contexts in `.github/rulesets.expected.json`.
- The Node 22/24 legs must keep running: the support range is a union, not a replacement, and Node 22 remains the LTS floor.
- The tooling `check` job's existing conditions (`needs: changes`, scope-selected `if:`) are part of the workflow contract tests and are orthogonal to `strategy`.

## Goals / Non-Goals

**Goals:**

- Exercise the declared `>=26` Node line in CI for the suites whose behavior depends on the Node runtime.
- Keep the required gate contexts and ruleset expectations stable.
- Keep the change reviewable: workflow wiring and contract assertions only, plus any Node 26 reds the new leg exposes.

**Non-Goals:**

- Node 26 legs for `frontend-ci`, `api-ci`, `mobile-ci` (their artifacts do not run on Node; Node is the build toolchain).
- Node 26 for the release-tooling lanes in `tooling-ci` (`cli-release`, `extension-release`): those run on the release runtime they publish with and are not part of the application support range question.
- Dropping or changing the Node 22/24 legs, or the `engines` range itself.
- Changing package versions or release metadata.

## Decisions

### D1: Pin the exact latest Node 26 patch (26.12.1), not a floating `26.x`

Exact pinning matches the existing style and keeps the leg name deterministic (`check (26.12.1)`), so a check context cannot silently change runtime between runs. Version bumps are deliberate commits. `26.12.1` was the newest release on `https://nodejs.org/dist/index.json` when the change was authored (2026-10-21). Alternative — `26.x` — would track new patch releases automatically but makes CI behavior and check-context names non-reproducible across time.

### D2: Tooling `check` runs 22.22.2 + the pinned Node 26, not all three lines

Repository tooling executes on whatever supported Node the operator chose, and the meaningful compatibility boundary is the oldest supported line plus the newest. The CLI suite already runs all three lines, so Node 24 tooling behavior is covered indirectly by the CLI jobs' tooling steps (`pnpm cli -- …` runs through `tooling/cli.mjs`). Adding a third tooling check leg would double that job's cost without covering a distinct risk class.

### D3: Matrix under the existing `check` job; gate jobs untouched

A GitHub Actions matrix job reports one job result: failure if any leg fails, success only if every leg succeeds or is skipped. `cli-gate`/`tooling-gate` already `needs:` the job and fail closed, so the matrix needs no gate changes and the required context names stay stable. Matrix legs appear as additional contexts (`check (22.22.2)`, `check (26.12.1)`), which are informational, not required. Renaming or splitting the gate jobs would strand required contexts, so that is explicitly avoided. Both matrices set `fail-fast: false` so one failing Node line does not cancel the remaining legs' results; a compatibility matrix is useful only when it reports every line in one run.

### D4: No Node 26 legs for frontend, API, or mobile

Those suites build browser bundles, Cloudflare Workers, and mobile JavaScript bundles. Node is a build tool in those pipelines, not the artifact runtime, so Node runtime differences do not translate into shipped behavior. Their existing pinned 22.22.2 build toolchain is sufficient coverage; adding legs there would add CI cost without testing the runtime the artifacts execute in.

### D5: Node 26 reds are fixed in this change, not deferred

The point of the leg is to surface latent failures. If a test fails only on Node 26, the fix belongs in this change, following the established pattern for prototype-comparison failures (`{ ...parsed }` before `deepStrictEqual`) or the actual root cause where it differs. Fixing them separately would land a red matrix and block the PR.
