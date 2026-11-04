# Validation

## Observed failure

On archive pull request #499, the human `ready_for_review` action started PR Review run `41765169905`, which completed successfully with no Important findings. The six validation workflows remained `action_required` on runs created by the draft `opened` event: Frontend CI `41764453928`, API CI `41764453932`, Mobile CI `41764453992`, CLI CI `41764453974`, Tooling CI `41764453966`, and Config CI `41764453996`. The author had to approve them separately. Their workflow definitions used `pull_request: null`, while PR Review explicitly included `ready_for_review`.

## Automated verification

- Before the workflow edits, `node --test tooling/ci-workflow.test.mjs` failed two tests as expected: the new assertion required four explicit activities but observed `pull_request: null`.
- After the workflow edits, the same focused command passed 13/13 tests.
- `pnpm test:ci` passed 87/87 tests.
- `pnpm agent:check` passed: rulesync doctor and generation check, 102/102 OpenSpec strict validations, and gh-aw compiled-output drift check.
- `git diff --check` passed.

## Running-environment verification

Pending: create the task pull request as a draft, then have the task author click **Ready for review** once. Verify that the `ready_for_review` event starts all six validation workflows and PR Review for the same head without approving workflows or commenting `/review`. Record the run IDs and required gate results here before delivery.

## Pre-push review

- Bugs: no Important findings. The diff only adds the missing event to the six existing triggers and tightens their shared contract test; scope selection and gate jobs are unchanged.
- Security: no Important findings. No credentials, permissions, dependencies, or additional network access were introduced.
- Compliance: no Important findings. The implementation matches `start-archive-ci-on-ready`; the real `ready_for_review` exercise is explicitly pending above and is required by task 3.3 before merge.
