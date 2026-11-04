# Validation

## Observed failure

On archive pull request #499, the human `ready_for_review` action started PR Review run `41765169905`, which completed successfully with no Important findings. The six validation workflows remained `action_required` on runs created by the draft `opened` event: Frontend CI `41764453928`, API CI `41764453932`, Mobile CI `41764453992`, CLI CI `41764453974`, Tooling CI `41764453966`, and Config CI `41764453996`. The author had to approve them separately. Their workflow definitions used `pull_request: null`, while PR Review explicitly included `ready_for_review`.

## Automated verification

- Before the workflow edits, `node --test tooling/ci-workflow.test.mjs` failed two tests as expected: the new assertion required four explicit activities but observed `pull_request: null`.
- After the workflow edits, the same focused command passed 13/13 tests.
- The first draft-PR run also exposed two legacy assertions in `extension-release-workflow.test.mjs` and `web-pages-workflow.test.mjs`; both now require the same four-event contract.
- `pnpm test:preflight` passed 104 tests with 2 environment-dependent skips.
- `pnpm test:extension-tooling` passed 18/18 tests.
- `pnpm test:ci` passed 87/87 tests.
- `pnpm agent:check` passed: rulesync doctor and generation check, 102/102 OpenSpec strict validations, and gh-aw compiled-output drift check.
- `git diff --check` passed.

## Running-environment verification

Task PR #510 was created as a draft. The issue-events API records `ready_for_review` by `boxcounter` at 2026-11-04 07:14:10Z. No workflow approval or `/review` comment was used.

On head `e0bcefb7804994e63fb2a51598012c105c408e76`, that transition started and completed all six validation workflows successfully:

- Frontend CI `41790891568`: Web and Extension gates SUCCESS.
- API CI `41790891592`: API gate SUCCESS.
- Mobile CI `41790891641`: Mobile gate SUCCESS.
- CLI CI `41790891565`: CLI gate SUCCESS.
- Tooling CI `41790891550`: Tooling gate SUCCESS.
- Config CI `41790891566`: agent-config drift check SUCCESS.

PR Review run `41790891574` also started from the same transition. It reported two compliance findings: the archive-body instruction did not yet mention CI, and this evidence record was still pending. The archive instruction and `docs/CI.md` were updated, and this record received the real run evidence. Follow-up PR Review run `41792952123` then reported No Important findings; the gate succeeded and added `ready-for-human-review`. The PR is delivered for code-owner review and merge.

Not separately verified before merge: another bot-authored archive PR after this fix, because the trigger change is not on `dev` yet. The #499 failure and the real #510 transition cover the before/after trigger behavior; the next real archive PR will exercise the bot-authored path.

## Pre-push review

- Bugs: no Important findings. The diff only adds the missing event to the six existing triggers and updates the affected workflow assertions; scope selection and gate jobs are unchanged.
- Security: no Important findings. No credentials, permissions, dependencies, or additional network access were introduced.
- Compliance: no Important findings. The archive-body and evidence findings were resolved, and follow-up run `41792952123` confirmed compliance. All 6/6 tasks are complete.
