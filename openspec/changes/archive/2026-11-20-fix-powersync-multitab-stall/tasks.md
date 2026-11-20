# Tasks

## 1. Approval and isolated delivery

- [x] 1.1 Record human approval of the proposal, design, and verification scope in `proposal.md` before the task PR opens.
- [x] 1.2 Work on `fix/powersync-multitab-stall` cut from `origin/dev` in an isolated worktree; verify the diff contains only this change.

## 2. Reproduction

- [x] 2.1 Reproduce the multi-tab initialization stall with the real 2.4.0 and 2.7.0 SDKs in Chrome under default background scheduling, and record negative results for frozen, closed, and crashed tabs and for a closed syncing tab.

## 3. Implementation

- [x] 3.1 Upgrade the Web PowerSync packages and the lockfile; verify Mobile's PowerSync dependencies are unchanged.
- [x] 3.2 Increment the Worker generation to `v5`; verify the production build emits `worker-v5.js` with revalidation headers and an asset index rooted at it.
- [x] 3.3 Defer live-query table resolution, initial runs, and re-runs while a page is hidden, release them after it stays visible for 500 ms, and exclude the extension bridge frame; cover these with unit and plugin tests that fail without the change.

## 4. Verification and review

- [x] 4.1 Run Web typecheck, lint, the full Web test suite, PowerSync tooling tests, the production build, the PowerSync release browser check, and `pnpm exec openspec validate --all --strict`; record results in `validation.md`.
- [x] 4.2 In a running production build, reproduce the multi-tab scenario before and after the change, verify mixed v4/v5 operation, and run owner write-path smoke checks; record results in `validation.md`.
- [x] 4.3 Prepare the running environment for human hands-on acceptance and record who accepted, when, and any adjustments before the task PR opens.
- [x] 4.4 Perform the Bugs, Security, and Compliance passes from `REVIEW.md`, resolve Important findings, and open a task PR targeting `dev` with `OpenSpec: fix-powersync-multitab-stall`.
