# Proposal

## Why

The first real draft archive pull request, #499, showed that **Ready for review** starts automatic review but not the required application and configuration CI workflows. Those workflows use GitHub's default pull-request trigger set, which excludes `ready_for_review`, so the author still had to click **Approve workflows to run**. This contradicts the approved one-action archive flow.

## What Changes

- Add `ready_for_review` to the existing pull-request triggers of all six validation workflows: Frontend CI, API CI, Mobile CI, CLI CI, Tooling CI, and Config CI.
- Preserve the existing `opened`, `synchronize`, and `reopened` triggers and each workflow's reusable `workflow_call` interface.
- Extend the existing workflow contract test so all six workflows must keep this complete trigger set.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-change-archiving`: when the task author marks an archive pull request ready, the same human action starts both automatic review and the required CI workflows.

## Non-goals

- No personal access token, bot allowlist, automatic approval, or automatic merge.
- No change to notification routing, review rules, CI scope selection, or application runtime behavior.

## Impact

- `.github/workflows/{frontend-ci,api-ci,mobile-ci,cli-ci,tooling-ci,config-ci}.yml`
- `tooling/ci-workflow.test.mjs`
- GitHub Actions pull-request runs only; no application dependencies or shipped application code change.
