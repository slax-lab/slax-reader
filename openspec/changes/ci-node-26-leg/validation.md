# Validation

## Change summary

- `cli-ci.yml`: the `check` matrix now runs Node 22.22.2, 24.15.0, and the pinned Node 26 release.
- `tooling-ci.yml`: the `check` job became a matrix of Node 22.22.2 and the pinned Node 26 release.
- Pinned Node 26 version: **26.12.1**, the latest release on `https://nodejs.org/dist/index.json` at authoring time (published 2026-10-21). Verified locally with nvm (`nvm install 26.12.1`, `node -v` → `v26.12.1`).

## Local validation

All commands below were run in the mission worktree on macOS arm64 with pnpm 11.25.0.

### OpenSpec

- `pnpm exec openspec validate --all --strict` — **75 passed, 0 failed**.

### Node 26.12.1 (the pinned leg)

| Command | Result |
| --- | --- |
| `pnpm cli -- typecheck` | pass |
| `pnpm cli -- test` | 5 passed, 0 failed |
| `pnpm cli -- test:package` | pass (`@slax-lab/reader-cli@1.0.2` tarball built and verified in a standalone consumer) |
| `pnpm test:preflight` | 104 passed, 2 skipped, 0 failed |
| `pnpm test:ci` | 67 passed, 0 failed |
| `pnpm test:cli-tooling` | 29 passed, 0 failed |
| `pnpm test:extension-tooling` | 18 passed, 0 failed |

### Node 22.22.2 (the unchanged floor, sanity check of the final tree)

| Command | Result |
| --- | --- |
| `pnpm test:preflight` | 104 passed, 2 skipped, 0 failed |
| `pnpm test:ci` | 67 passed, 0 failed |

## Node 26 failures found during the mission

The pinned Node 26 leg exposed the documented prototype-comparison regression in two tooling tests: `util.parseEnv` returns a null-prototype object, and Node >= 25 `assert.deepStrictEqual` compares prototypes, so plain object literals no longer matched.

- `tooling/env-files.test.mjs` — spread the parsed object into a plain object before `deepStrictEqual`.
- `tooling/preflight.test.mjs` — same spread for `parseEnvText` output.

The original mission base (`feat/branch-protection-model`) predated PR #368, so the failures reproduced there, and the fix applied was identical to #368. The tower then approved rebasing the branch onto `origin/dev`, which already carries that fix; the rebased branch has **no diff** versus `origin/dev` for either file, so the final change contains no test-file modification. The Node 22.22.2 run above confirms the spread is version-agnostic.

## Base decision

`feat/branch-protection-model` was merged to `dev` as a squash commit (`3ba4b772`, PR #350), so it is not an ancestor of `dev`. The tower approved rebasing `feat/ci-node-26-leg` onto `origin/dev`; after the rebase the pull request diff contains only this mission's files (two workflows, `tooling/ci-workflow.test.mjs`, and the `openspec/changes/ci-node-26-leg/` artifacts).

## Workflow contract verification

- `cli-gate` still `needs: [changes, check]` and `tooling-gate` still `needs: [changes, check, cli-release, extension-release]`, both `if: always()` with the fail-closed result loop. A matrix job reports one result (failure if any leg fails), so the gates aggregate the whole matrix and keep their exact names `CLI CI gate` / `Tooling CI gate`.
- `.github/rulesets.expected.json` references only those gate context names (lines 55, 67, 142, 158) and contains no Node version or matrix data — **no change required**.
- `tooling/ci-workflow.test.mjs` now asserts the CLI matrix `['22.22.2', '24.15.0', '26.12.1']`, the tooling `check` matrix `['22.22.2', '26.12.1']`, and that both jobs wire `node-version: ${{ matrix.node }}`. `pnpm test:ci` passes with these assertions on both Node 22.22.2 and Node 26.12.1.
- No other workflow or contract test asserts the old CLI/tooling matrix. Release lanes (`cli-release`, `extension-release`, `cli-release.yml`, `extension-release.yml`) keep Node 24.15.0; frontend, API, mobile, and ruleset-drift keep 22.22.2, all unchanged by design.

## Running-environment exercise

The changed behavior is the GitHub Actions matrix itself, which only runs on GitHub. Local runs above execute the exact commands each leg runs; the pull request's own CI run exercised the new legs end to end on PR #373:

- `check (26.12.1)` passed in both `CLI CI` and `Tooling CI`; `check (22.22.2)` passed in both; `check (24.15.0)` passed in `CLI CI`.
- `CLI CI gate`, `Tooling CI gate`, `Web CI gate`, `Extension CI gate`, `API CI gate`, and `Mobile CI gate` all passed (`tooling/ci-*` selects every scope, so the full suites ran).
- `PR review gate` passed with "no Important findings"; `agent-config drift check` passed.
- `cli-release` and `extension-release` passed on their unchanged Node 24.15.0 runtime.

## Not verified (declared gaps)

- The Node 24.15.0 CLI leg was not re-run locally (that leg is unchanged and CI covers it; the local run focused on the new Node 26 leg plus the Node 22 floor). CI passed it on PR #373.
- GitHub Actions scheduling of the new matrix legs cannot be exercised before the PR exists; the PR #373 run was the exercise and passed as listed above.
- `docs/CI.md` (lines 51, 54, 106) and `docs/cli/RELEASE.md` (line 3) still describe CLI validation on Node 22.22.2 and 24.15.0 only. Those files are outside this mission's file scope; the drift is filed as a follow-up finding for the tower.
