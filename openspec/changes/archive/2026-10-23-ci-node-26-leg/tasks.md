# Tasks

## 1. OpenSpec change

- [x] 1.1 Author `proposal.md`, `design.md`, and this `tasks.md`, plus the delta spec for the new capability `ci-test-matrix`; verify `openspec validate --all --strict` passes

## 2. Pin and wire the Node 26 leg

- [x] 2.1 Determine the latest exact Node 26 release from `https://nodejs.org/dist/index.json` and pin it (26.12.1, matching the existing exact-version style)
- [x] 2.2 Append the pinned Node 26 leg to the existing matrix in `.github/workflows/cli-ci.yml`
- [x] 2.3 Convert the `check` job in `.github/workflows/tooling-ci.yml` from single-version 22.22.2 to a matrix of 22.22.2 plus the pinned Node 26 version

## 3. Contract tests

- [x] 3.1 Update `tooling/ci-workflow.test.mjs` matrix assertions for the new legs, and assert the tooling `check` matrix; verify `pnpm test:ci` passes on Node 26.12.1

## 4. Local validation on the pinned Node 26

- [x] 4.1 Run the full CLI suite on Node 26.12.1: `pnpm cli -- typecheck && pnpm cli -- test && pnpm cli -- test:package`
- [x] 4.2 Run the tooling suites on Node 26.12.1: `pnpm test:preflight`, `pnpm test:ci`, `pnpm test:cli-tooling`, `pnpm test:extension-tooling`
- [x] 4.3 Fix any Node 26 failures inside this change (prototype-comparison failures get `{ ...parsed }` before `deepStrictEqual`; other root causes fixed directly) and re-run the affected suites

## 5. Gates, rulesets, and verification record

- [x] 5.1 Confirm `CLI CI gate` and `Tooling CI gate` still aggregate the whole matrix and `.github/rulesets.expected.json` needs no change; confirm no other workflow or contract test asserts the old matrix
- [x] 5.2 Record commands, results, and any evidence gaps in `openspec/changes/ci-node-26-leg/validation.md`
- [x] 5.3 Update `docs/CI.md` (coverage table, Tooling CI matrix, Full CI wording) and `docs/cli/RELEASE.md` so every Node-coverage statement matches the new matrices

## 6. Pull request

- [x] 6.1 Run the local pre-push review defined in `REVIEW.md`; resolve Important findings
- [x] 6.2 Open the PR targeting `dev` with the repository pull-request template, the line `OpenSpec: ci-node-26-leg`, and a Test plan summarizing the local Node 26.12.1 runs and the CI matrix outcome
- [x] 6.3 Watch the PR checks to completion and report the final state; the human merges
