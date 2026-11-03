# Validation

## Acceptance scope

Verify the Safe Outputs source and compiled lock, archive PR instructions, operational documentation, and existing CI contracts. The next real archive PR must additionally verify the publication fields and review handoff; those observations are rollout evidence, not tasks that would make this change's own archive depend on its output.

## Local verification

- `node --test tooling/openspec-archive-workflow.test.mjs`: the new draft and instruction assertions failed before the workflow edit, with `undefined !== false` for `draft` and a missing `Approve workflows to run` instruction. The bot assertion also failed before `on.bots` was added. After the workflow changes, all 7 tests passed.
- `node --test tooling/openspec-archive-workflow.test.mjs tooling/ci-workflow.test.mjs`: 20 tests passed, 0 failed.
- `pnpm test:ci`: 87 tests passed, 0 failed.
- `gh aw compile --strict --purge --no-check-update`: three workflows compiled. The existing conclusion-concurrency warning remains intentional.
- `pnpm agent:check`: rulesync checks, strict OpenSpec validation (97 items, 0 failed), and the gh-aw drift check passed; compiled workflows match their sources.
- `git diff HEAD --check`: passed with no whitespace errors.
- Source and compiled Safe Outputs configuration explicitly set `draft: false`, retain `reader-core`, disable issue fallback, and define no custom publish token.
- Only automatic `pr-review.md` declares `on.bots: ["github-actions[bot]"]`; its compiled lock contains `GH_AW_ALLOWED_BOTS` with that identity. Neither `pr-review-command.md` nor its compiled lock enables bot-authored `/review` commands, and the gate is unchanged.
- The PR-body prompt and `docs/CI.md` now give both start choices: approve the approval-required workflows or comment `/review` when no review is running. They explicitly avoid a draft-to-ready transition and any additional start action when review is already running.

## Prior live evidence

Archive PR #485 demonstrated the original defect: gh-aw created it as a draft, its initial team-review request returned HTTP 422, and the readiness gate could not label it. A manual ready-for-review transition made the team request and automated review succeed. This change removes that transition rather than claiming it as the intended long-term behavior.

Review of the proposed approval path also showed why the bot allowlist is necessary: workflow approval preserves `github-actions[bot]` as `github.actor`, while the existing role check otherwise skips the agent. The new allowlist is limited to automatic review and does not bypass human workflow approval.

## Pending rollout evidence

After this task PR merges and the bridge's start-review notification is deployed, inspect the next real archive PR for all of the following:

- `isDraft == false` and an effective `slax-lab/reader-core` team review request without a manual ready-for-review transition.
- A body containing both start choices and the `Archive source:` link.
- No duplicate `/review` command when a review is already running.
- After workflow approval, the automatic PR Review `activation` and agent jobs actually execute rather than being skipped for bot membership.
- The resulting review gate and `ready-for-human-review` label.
- Exactly one start-review direct message to the task PR author from the separate bridge change, followed by one established readiness group card.

No live result for the revised workflow is claimed by the local checks above.

## Local pre-push review

- **Bugs:** the initial independent review correctly found that workflow approval alone would leave the bot actor unauthorized. The final revision adds the bot only to automatic review and leaves `/review` and the gate unchanged. Source and lock contracts cover this boundary. No additional bug was found in the final self-review.
- **Security:** human workflow approval remains required; agent token permissions, network allowlists, and Safe Outputs write boundaries are unchanged. No new credential or on-demand bot command is introduced. The accepted whitelist risk and next-live activation check are recorded above.
- **Compliance:** the implementation matches the revised proposal and both capability deltas. Local checks and the pending live evidence are distinct. The follow-up independent review could not run because the provider returned HTTP 503 twice; this section records the completed self-review rather than treating those failed calls as a successful independent review.
