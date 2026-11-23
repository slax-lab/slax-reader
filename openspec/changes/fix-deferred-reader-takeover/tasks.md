# Tasks

## 1. Approval

- [x] 1.1 Record the requester's 2026-11-23 instruction to fix every confirmed finding of the two test-environment passes ("都修吧").

## 2. Implementation

- [x] 2.1 Let `useReadingPosition` wait for `enabled()` and expose `retry()`; call it after a late switch in `[id].vue`. Verify with unit tests: late switch restores once; reader scroll or keyboard before the switch prevents the jump; no `clear()` before the switch; an early switch behaves as before.
- [x] 2.2 Report REST-phase mark writes from `BookmarkArticleLocalFirst` and include them in the hand-over comparison. Verify with unit tests: an added mark keeps REST marks until local rows include it live; a deleted mark keeps REST marks until local rows mark it deleted or drop it; existing hand-over tests pass.
- [x] 2.3 Let history traversals out of a deferred document complete and load the destination as a new document; keep push and replace behavior. Verify with unit tests for traversal, push, and same-path navigation.
- [x] 2.4 Return `unavailable()` for a top-level `/x/ext-bridge` and `/x/ext-bridge/`; add the `frame-ancestors` rule for `/x/ext-bridge/`. Verify with unit tests and the built route rules.

## 3. Verification

- [x] 3.1 Run Web lint on changed files, `typecheck`, `pnpm web -- test`, and `openspec validate --all --strict`.
- [x] 3.2 Exercise a production-mode build in Chrome against a full local environment (local API, PostgreSQL, and PowerSync) with delayed local startup, on the unfixed and fixed builds: late-switch position restore, REST-phase highlight with no disappearance, Back after reloading an article, top-level `/x/ext-bridge` without sync, and the `/x/ext-bridge/` header. Record results in `validation.md`.
- [x] 3.3 Complete the local `REVIEW.md` review and the requester's hands-on acceptance before the pull request.
