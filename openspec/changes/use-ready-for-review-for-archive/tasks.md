# Tasks

## 1. Use the human ready-for-review transition

- [x] 1.1 Update the workflow contract tests to require draft archive creation, the absence of the added bot allowlist from both review workflows, and an archive-body instruction that explains the merged feature PR, automatic archive creation, **Ready for review**, automatic review, and final team merge; run them before implementation and confirm they fail.
- [x] 1.2 Remove `draft: false` from `.github/workflows/openspec-archive.md` and `on.bots` from `.github/workflows/pr-review.md`, update the archive-body instruction, and regenerate with `gh aw compile --strict --purge --no-check-update`; verify the tests and compiled locks reflect the new path.
- [x] 1.3 Update `docs/CI.md` to describe the draft archive, the author's inspection and **Ready for review** action, and the subsequent automatic review, gate, team review, and merge; verify it no longer presents Approve or `/review` as the archive's start choice.

## 2. Verification and delivery

- [x] 2.1 Run focused workflow tests, `pnpm test:ci`, `pnpm agent:check`, and `git diff HEAD --check`; record exact results and pending live evidence in `openspec/changes/use-ready-for-review-for-archive/validation.md`.
- [ ] 2.2 Run the local pre-push review required by `REVIEW.md`, resolve Important findings, and open one task PR targeting `dev` with `OpenSpec: use-ready-for-review-for-archive` and a Test plan that separates local verification from the next real draft-archive observation; do not merge it as an agent.
