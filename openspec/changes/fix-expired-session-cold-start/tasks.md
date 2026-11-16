# Tasks

## 1. Approval and isolated delivery

- [x] 1.1 Record human approval of the proposal, design, and regression scope in `proposal.md`; verify approval is explicit before runtime or test edits begin.
- [x] 1.2 Create an isolated task checkout on `fix/fix-expired-session-cold-start` from `origin/dev` and carry only this change's planning artifacts into it; verify branch ancestry and a diff free of unrelated changes.

## 2. Regressions and minimal fix

- [x] 2.1 Add deterministic regressions for a locally expired login token and a sync-token HTTP 401 before first render, using the real PowerSync plugin connector, authentication cleanup, fresh Pinia user store, and locale API with controlled database/network boundaries; run them against the old implementation and record the expected locale-initialization failure.
- [x] 2.2 Initialize store locale from Nuxt's application composer without component-only `useI18n()`; verify the new cold-start cases pass, cleanup removes the session, login navigation proceeds, the expired-token case makes no sync-token HTTP request, and subsequent real layout setup can use the same store without a fatal error.
- [x] 2.3 Cover fresh English/Chinese startup outside component setup and persisted-language restoration without implicit account writes; verify these tests and existing store, auth, locale-fallback, connector, and PowerSync session tests pass.

## 3. Verification and review

- [x] 3.1 Run the focused regression suite, required Web lint/typecheck/tests/build checks, and `pnpm exec openspec validate --all --strict`; record actual command results and any unrelated baseline failures in `validation.md`.
- [x] 3.2 Exercise `/` and direct `/bookmarks` cold entry in a running browser with synthetic expired and server-rejected sessions, plus clean-session and persisted-language smoke flows; record first-visit login recovery, absence of the two reported errors, environment details, and any unverified scenario with its reason in `validation.md`.
- [x] 3.3 Prepare the running environment for human hands-on acceptance of the restored login behavior; record who accepted, when, and any adjustments before opening the UI-visible task PR, as required by `DESIGN.md` section 10.2.
- [x] 3.4 Perform the Bugs, Security, and Compliance passes from `REVIEW.md`, resolve Important findings, and prepare a task PR targeting `dev` with `OpenSpec: fix-expired-session-cold-start` and linked verification evidence; verify the PR scope is Web-only and leave archive work until after merge.
