# Validation

## Acceptance scope

Pre-merge acceptance covers the compiled workflow, its trigger and permission contracts, evidence-based archive instructions, generated-file integrity, agent-rule generation, and strict OpenSpec validation. An isolated gh-aw trial is required before the main PR opens. Real merge-trigger, archive-PR, readiness-label, and Feishu-notification observations are mandatory rollout evidence, but they are not unchecked implementation tasks that would make the first automatic archive depend on its own output.

The historical active-change backlog is outside this change's archive scope.

## Local verification

- `openspec status --change automate-openspec-archive-pr --json`: all four required planning artifacts were present before implementation.
- `openspec validate --all --strict`: 94 items passed, 0 failed. Informational long-requirement notices remain non-blocking.
- `node --test tooling/openspec-archive-workflow.test.mjs`: all five tests failed with ENOENT before `.github/workflows/openspec-archive.md` existed; all five passed after implementation.
- `node --test tooling/openspec-archive-workflow.test.mjs tooling/ci-workflow.test.mjs`: 18 tests passed, 0 failed.
- `gh aw validate`: three workflows compiled successfully. The single remaining warning reports a shared dispatch conclusion group; global serialization is intentional because same-capability archive writes must not race.
- `tooling/check-gh-aw-drift.sh` after staging the complete workflow source/generated set: `Compiled workflows match their sources.`
- `pnpm agent:sync`: regenerated `AGENTS.md` and `CLAUDE.md` from the rulesync source.
- `pnpm agent:check`: rulesync doctor and generation checks passed, strict OpenSpec validation passed 94 items, and the gh-aw drift check passed.
- `git diff HEAD --check`: passed with no whitespace errors.
- `gh aw trial ./.github/workflows/openspec-archive.md --clone-repo slax-lab/slax-reader --delete-host-repo-after --dry-run --yes --json`: dry-run completed without creating a repository. The actual trial uses `--trigger-context https://github.com/slax-lab/slax-reader/pull/341`; gh-aw forwards that PR number as `issue_number`, so no production replay default exists.
- The first real trial attempt cloned the host but failed before execution because the relative workflow path was not resolved during installation. Automatic host cleanup also failed with HTTP 403 because the token lacks `delete_repo`. A retry uses the absolute workflow path and the existing private trial host, without creating another repository or claiming cleanup.

## Compiler security review

The new workflow reuses the repository's existing `DEEPSEEK_API_KEY`; it introduces no new secret value and no new third-party action beyond the pinned gh-aw and standard action set already used by the repository. The compiler's safe-update warning names only `DEEPSEEK_API_KEY` as a newly restricted secret reference for this workflow. Its standard gh-aw token wiring is unchanged.

The key is supplied to the same DeepSeek engine configuration already used by PR review. Network access is limited to gh-aw defaults, `api.deepseek.com`, and `registry.npmjs.org`; the pinned OpenSpec package already used by this repository is fetched through npm. No credential value is printed or added to an artifact. Agent permissions are read-only. The only enabled external writes are one comment and one documentation PR through Safe Outputs, with `slax-lab/reader-core` as reviewer. Merge, approval, direct-push, review-submission, issue-creation, and direct Feishu outputs are not enabled.

## Local review

- **Bugs:** the full source and generated diff was inspected. The initial import path error was found by strict gh-aw validation and corrected. A bootstrap dependency in the original task list would have blocked the first archive on its own output; live observations moved to rollout evidence without removing any check. No remaining Important finding.
- **Security:** the trigger is merged-only and same-repository, the agent token is read-only, publication uses Safe Outputs, no automatic merge or approval exists, and the notification path is unchanged. The new restricted secret reference is reviewed above. No Important finding.
- **Compliance:** the implementation matches the proposal and `openspec-change-archiving` delta. Rulesync and gh-aw outputs were regenerated through their owners. Task classification, same-capability ordering, duplicate prevention, strict validation, human archive review, and the bridge-first rollout remain in scope. No Important finding.

## Required rollout order and pending evidence

1. Create and obtain human approval for the separate `slax-notify-bridge` proposal. Do not change bridge configuration before that approval.
2. Implement and verify the bridge roster change, deliver its reviewed PR, and confirm its Deploy workflow succeeds.
3. Run the compiled archive workflow in an isolated gh-aw trial against cloned repository state with a known merged archive-eligible PR. Record the generated PR, task classifications, spec result, validation output, reviewer, Safe Output types, real-repository non-effects, and cleanup.
4. Open the main task PR only after steps 1-3 succeed. Record its checks and review outcome here.
5. After the human merges the main PR, record the real merge-triggered run and generated archive PR for `automate-openspec-archive-pr`.
6. Before human archive review, record the archive PR's `ready-for-human-review` label, the single Feishu group card mentioning `slax-lab/reader-core`, and the absence of a duplicate archive PR.
7. After the human merges the archive PR, remove only this task's worktree and merged local branch.

Steps 1-2 are complete: the bridge proposal was approved, bridge PR #69 merged after review, and Deploy run 41433106389 succeeded. Step 3 reached a real workflow run (41442622661), but the agent failed with HTTP 403 during provider authentication because the isolated host lacked `DEEPSEEK_API_KEY`; no archive step or archive PR occurred. The human added the secret, and run 41559033269 completed successfully but returned `noop`: the prompt's raw `inputs.issue_number` was false and the direct trial context had no source PR. The workflow now passes `ARCHIVE_SOURCE_PR_NUMBER` explicitly, and the retry uses `--logical-repo slax-lab/slax-reader` so the agent reads the real source PR. Steps 4-7 remain pending. No live trigger, real archive PR, or Feishu delivery is claimed by the local checks above.
