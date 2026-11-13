# Tasks

## 1. Approval and Scope

- [x] 1.1 Record the change requester's 2026-11-12 approval of the observability-first plan and the separate future auto-resume change in `proposal.md`; verify this change contains no automatic-save implementation and does not prohibit the separate `snapshot-save-auto-resume` change.
- [x] 1.2 Confirm the task worktree and branch `feat/snapshot-save-observability` based on `origin/dev` commit `89aee48f`; verify the working diff contains only this change's implementation and tests.

## 2. Shared Attribution Contract

- [x] 2.1 Add the closed `SnapshotAuthAttribution` type and guard to the shared events contract and include it in the optional Web attribution union; verify `pnpm --filter @slax-reader/contracts typecheck` passes.
- [x] 2.2 Preserve collection and HackerLinks guard semantics while adding the snapshot branch; verify existing collection attribution tests still pass.

## 3. Web Observation

- [x] 3.1 Add `data-analytics-element="snapshot_save_button"` and the source-snapshot data attribute to the existing snapshot save control; verify the Web fork test asserts both attributes and the authenticated save path.
- [x] 3.2 Pass snapshot attribution from the anonymous save path into the existing sign-in modal without changing the return redirect; verify the same-source anonymous and authenticated test.
- [x] 3.3 Carry snapshot attribution through the modal view, Google and Apple controls, both OAuth state payloads, the `/auth` callback, and callback recovery; verify Google, Apple, ordinary-login, and callback tests.
- [x] 3.4 Add `source_bookmark_id` to the existing global element-click observation only when the element exposes the source attribute; verify the plugin test records two same-source snapshot activations and no source on an ordinary element.

## 4. API Attribution and Save Facts

- [x] 4.1 Validate snapshot attribution at the login boundary and attach it to both `user_created` and `user_logged_in` for Google and Apple while rejecting invalid or forged metadata without failing authentication; verify the API attribution tests.
- [x] 4.2 Add `source_bookmark_id` to `bookmark_saved` and `bookmark_save_failed` only for trusted `/b/<uuid>` targets on `/add_url`, including admission failure and rate limiting; verify ordinary saves, lookalike origins, content saves, and fork outcomes remain distinct.

## 5. Verification

- [x] 5.1 Run the affected Web suites covering save activation, modal attribution, providers, OAuth callback, ordinary login, collection regression, and the click collector; verify 12 files and 154 tests pass.
- [x] 5.2 Run the affected API suites covering account attribution and save facts; verify 2 files and 83 tests pass.
- [x] 5.3 Run shared-contract, Web, and API typechecks plus targeted ESLint and `git diff --check`; verify all typechecks pass and lint reports no errors.
- [x] 5.4 Record the exact commands and results, the full-suite results under the CI toolchain, environment prerequisites, and every unverified runtime boundary in `validation.md`.
- [x] 5.5 Run `openspec validate --all --strict` and record this change's result separately from pre-existing external informational or failing items in `validation.md`.

## 6. Independent Review Correction

- [x] 6.1 Fix the rate-limit telemetry boundary so a legitimate small `add_url` body without `Content-Length` is read within the existing 100 KiB bound, while oversized or streaming bodies remain unparsed; apply the save handler's HTTPS normalization to scheme-less snapshot targets.
- [x] 6.2 Add API regressions for a no-Content-Length snapshot fork, a scheme-less snapshot target, an ordinary URL with no source, and an over-100 KiB body that is not parsed; verify the updated API suites pass.
- [x] 6.3 Rerun `pnpm --filter slax-reader-backend typecheck`, targeted ESLint, `git diff --check`, and `openspec validate --all --strict`; record the independent full API run (250 files passed and 17 skipped; 3,996 tests passed and 144 skipped) and the full Web result in `validation.md`.

## 7. Scope and Full-Web Closeout

- [x] 7.1 Replace the permanent no-auto-save requirement with a scope boundary that names the separate `snapshot-save-auto-resume` change, without requiring or prohibiting that later behavior; verify `openspec validate --all --strict`.
- [x] 7.2 Record the full Web result under the CI toolchain (241 files passed and 1 skipped; 2,907 tests passed and 3 skipped) as accepted evidence, and keep the Node 26.12.1 local-toolchain failures only as a non-CI footnote that does not describe the repository as broken.

## 8. Q7 Contract Corrections

- [x] 8.1 Define `LoginModalAttribution` as collection-or-snapshot and use it in `LoginModal` and `showLoginModal`; keep the standalone Google, Apple, and email components on the wider `WebAuthAttribution`; verify Web typecheck.
- [x] 8.2 Validate `source_bookmark_id` as the `sr_user_bookmark.uuid` UUID format in the `/auth` callback schema and the API login schema; add non-UUID cases and verify Web/API tests.
- [x] 8.3 Cover the existing email code path inside the snapshot modal at the Web request layer and the API `user_created`/`user_logged_in` layer; keep the no-code and `EMAIL_AUTH_USE_EXISTING_LOGIN` recovery paths outside scope.
- [x] 8.4 Rerun the affected Web/API tests, typechecks, targeted ESLint, `git diff --check`, and `openspec validate --all --strict`; record the results and the recovery gap in `validation.md`.
- [x] 8.5 Clarify that the attributed provider click is allowed on the snapshot modal or the `/auth` recovery page; verify existing recovery-propagation and provider-click tests compose the coverage and record the absence of an integrated browser recovery click in `validation.md`.

## 9. Final Review Corrections

- [x] 9.1 Reconcile every test count in `validation.md` and `tasks.md` with the Node 22.22.2 focused runs (Web 12 files/154 tests; API 2 files/83 tests) and with the independently confirmed full runs (Web 241 files passed/1 skipped and 2,907 tests passed/3 skipped; API 250 files passed/17 skipped and 3,996 tests passed/144 skipped), and demote the Node 26.12.1 result to a non-CI footnote.
- [x] 9.2 Bring both `request.clone()` calls in `rateLimit.ts` inside exception handling so a clone failure emits `bookmark_save_failed` without a source and cannot leave the `waitUntil` promise rejected; keep the 100 KiB bounded read and normal save behavior unchanged.
- [x] 9.3 Make the element-click collector test assert exactly two snapshot clicks and one ordinary click with `screen_name=detail`, and remove the captured document listeners after each test without changing production code.
- [x] 9.4 Reference the Q7 decision in `proposal.md` and `design.md` by repository-relative path in `slax-reader-event-tracking`, and record that its separate branch and pull request must land before this change merges.
