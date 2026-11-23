# Tasks

## 1. Approval

- [x] 1.1 Record the requester's 2026-11-23 instruction to fix every confirmed finding of the two test-environment passes ("都修吧").

## 2. Implementation

- [x] 2.1 In `useUserSubscribe`, start a fresh check when the account generation changes for a signed-in reader and no check for the current generation and account is in flight. Verify with unit tests: a same-account generation bump during and after a check leads to a new request and a final non-pending state; a failure after the bump reports `error` and starts nothing further; a service that always fails makes one request and stops; follow-ups after identity changes during a check are bounded; a logged-out bump starts nothing; existing account-switch and coalescing tests pass.

## 3. Verification

- [x] 3.1 Run Web lint on changed files, `typecheck`, `pnpm web -- test`, and `openspec validate --all --strict`.
- [x] 3.2 Exercise a production-mode build against a full local environment (local API, PostgreSQL, and PowerSync), on the unfixed and fixed builds, with a forced same-account identity invalidation: Chat leaves "checking" and reaches the account's real decision. Record results in `validation.md`.
- [x] 3.3 Complete the local `REVIEW.md` review and the requester's hands-on acceptance before the pull request.
