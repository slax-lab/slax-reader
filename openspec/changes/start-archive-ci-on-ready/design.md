# Design

## Context

See `proposal.md` for the observed #499 failure. The six validation workflows currently use `pull_request: null`, which selects GitHub's default `opened`, `synchronize`, and `reopened` activities. PR Review already declares `ready_for_review` explicitly. These validation YAML files are hand-written; no gh-aw lock regeneration is involved.

## Goals / Non-Goals

**Goals:**

- Make one human **Ready for review** action start every required PR workflow.
- Preserve reusable full-CI calls and scope-based job selection.

**Non-Goals:**

- Do not change merge protection, human code-owner review, review gating, or notification behavior.
- Do not add credentials or broaden workflow permissions.

## Decisions

### D1. Declare the complete pull-request trigger set in each validation workflow

Use `types: [opened, synchronize, reopened, ready_for_review]` in Frontend CI, API CI, Mobile CI, CLI CI, Tooling CI, and Config CI. This adds the missing activity without replacing any existing trigger.

Alternative: leave CI waiting at `opened` and ask the author to approve it after Ready. Rejected because it requires a second action and was the observed #499 failure.

### D2. Strengthen the existing contract test rather than adding a parallel test file

Update `assertValidationTriggers` in `tooling/ci-workflow.test.mjs` to require the four explicit activities for every entry in `validationWorkflows`. The existing test already loads all six workflow files and checks their reusable `workflow_call` contract.

### D3. Verify the event with a real pull request before merge

Run the contract test locally, then exercise `ready_for_review` on the task pull request and confirm that all six validation workflows run for the same head. Record the run evidence in `validation.md`; static YAML inspection alone is insufficient.

## Risks / Trade-offs

- **Risk:** GitHub does not associate every ready-triggered run with the pull request. **Mitigation:** verify all six run IDs and required gate contexts on the real PR before merge.
- **Trade-off:** every draft-to-ready transition now runs validation, not only archive pull requests. This is required for a consistent repository-level trigger; scope selection still skips unrelated application suites.
