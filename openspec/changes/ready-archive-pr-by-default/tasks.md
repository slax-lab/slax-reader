# Tasks

## 1. Archive PR creation and instructions

- [x] 1.1 Extend `tooling/openspec-archive-workflow.test.mjs` to require `draft: false` and both workflow-start choices in the archive PR body; run it before the workflow edit and confirm the new assertions fail.
- [x] 1.2 Set `safe-outputs.create-pull-request.draft: false` and update the PR-body prompt in `.github/workflows/openspec-archive.md`; regenerate with `gh aw compile --strict --purge --no-check-update` and verify the source tests and compiled lock reflect non-draft creation, the team reviewer, and both instructions.
- [x] 1.3 Update `docs/CI.md` so non-draft creation, the required workflow-start choices, and the absence of any additional action when review is already running are distinguished accurately; verify no instruction requires a manual ready-for-review transition.
- [x] 1.4 Add `bots: ["github-actions[bot]"]` only to `.github/workflows/pr-review.md` and its contract tests, regenerate locks, and verify the on-demand command workflow and gate remain unchanged while the approved archive bot can activate automatic review.

## 2. Verification and delivery

- [x] 2.1 Run the focused workflow tests, `pnpm test:ci`, `pnpm agent:check`, and `git diff HEAD --check`; record exact results and any remaining live-rollout gaps in `openspec/changes/ready-archive-pr-by-default/validation.md`.
- [ ] 2.2 Run the local pre-push review required by `REVIEW.md`, resolve Important findings, and open one task PR targeting `dev` with `OpenSpec: ready-archive-pr-by-default` and a Test plan that distinguishes local verification from the next live archive PR evidence; do not merge it as an agent.
