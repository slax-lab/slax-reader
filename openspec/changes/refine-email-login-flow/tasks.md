# Tasks

Sections 1–5 record the previously verified draft delivery. Their earlier rollout restrictions are superseded by the requester-approved all-environment amendment in section 6.

## 1. Provider-first Presentation and Beta Availability

- [x] 1.1 After proposal approval, reorder the standalone login and account methods to Google, configured Apple, email; preserve the modal's matching source order and existing invitation/provider/cancellation behavior. Verify DOM and keyboard order in both hosts and bound/unbound account component tests.
- [x] 1.2 Apply quiet secondary styling to collapsed email login and the account email-link action using existing Web tokens, preserving visible labels/icons/focus, 44px targets, and clear expanded Send/Verify actions. Verify both locales at 320px/768px/desktop in all Web themes, including the 320x568 modal.
- [x] 1.3 Completed the initial Web beta rollout and its allowed/omitted-profile regression checks (historical). Section 6 replaced that intermediate implementation: current Web/App email login and account binding have no environment predicates.

## 2. Successful Email Preference

- [x] 2.1 Add the one-address browser preference boundary and anonymous-form prefill; write only after successful session persistence and abort validation, before departure. Verify last-success replacement, persistence across remount/logout, editable initial value, no write on send/failure/cancel, unusable/unavailable storage, and no email secret/session storage in the new preference.
- [x] 2.2 Keep the preference out of account binding; verify remembered anonymous email neither prefills an empty binding field nor changes after binding, and retain existing account ownership, success announcement, and focus tests.

## 3. Verification Departure Lock

- [x] 3.1 First reproduce the successful-navigation gap in the existing login suites with navigation initiation resolved while the component remains mounted; assert Verify must remain disabled and a second submit must not verify again, and record the initial failing result.
- [x] 3.2 Add a login-selected terminal success lock without changing binding completion. Verify click/Enter/direct-submit, input/resend/change-address and cancel/reopen stay blocked during departure; wrong-code failures remain retryable, pre-success cancellation/provider-switch abort remains effective, explicit navigation failure still reports an error, and abandoned results neither persist a preference nor replace a session.

## 4. Running Verification and Delivery

- [x] 4.1 Run affected component/preferences/auth regression suites, Web typecheck, targeted lint, whitespace checks, and strict OpenSpec validation; perform the local Bugs/Security/Compliance review and record exact results and limitations in this change's `validation.md`.
- [x] 4.2 Exercise the actual Nuxt application with a loopback fixture: both login hosts and account binding, new/remembered/edited address, failed/retried and successful verification, delayed destination loading, the initial beta availability/production omission (historical; replaced by section 6), provider order, keyboard access, narrow layout and all Web themes. Record requests and inspect the still-visible successful form during delayed departure; keep screenshots/harnesses outside Git.
- [x] 4.3 Present the running Web implementation for fresh requester hands-on acceptance (received 2026-11-12), and obtain separate acceptance of the approved App presentation extension; implement/re-verify feedback and record who/when/what before opening a task PR. Deliver on `fix/refine-email-login-flow` targeting `dev` with OpenSpec and verification evidence; do not archive before merge, and keep the three predecessor capability deltas under their single owners for coordinated archive.


## 5. App Provider Preference Extension

- [x] 5.1 Keep Google/iOS-Apple/email login order, give email a local borderless secondary treatment, and move the whole account mailbox group below provider states/actions with a quiet binding button. Verify mounted Android/iOS control order, labels, targets, pressed/disabled behavior, agreement continuation, bound/unbound status, and the initial non-development omission in existing tests (historical; replaced by section 6).
- [x] 5.2 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, strict OpenSpec validation, and whitespace checks. Exercise isolated native Android/iOS login and account surfaces, capture evidence outside Git, review the affected diff, and record exact outcomes/limitations in `validation.md` before requesting App hands-on acceptance.
- [x] 5.3 After implementation and validation, obtain the Mobile version decision under `docs/release/VERSIONING.md` before committing/pushing/handoff as ready; record the decision and verify any approved metadata update through the existing tooling.


## 6. All-environment Email Availability (approved 2026-11-13)

- [x] 6.1 Reconcile the single-owner capability deltas and remove Web and native environment gates, including the native binding controller; preserve fixture isolation, provider preference, session/ownership guards, and existing UI behavior.
- [x] 6.2 First reproduce production/non-development omission with updated login/account regressions, then verify complete production-profile Web login/modal/binding and native non-development binding, run affected checks and native bundles, and record fresh running-client evidence and limits.
- [x] 6.3 Complete the local Bugs/Security/Compliance review and update the same PR #597 (a draft at that delivery checkpoint) with the all-environment policy and evidence, retaining the accepted UI and Mobile version/build decision.


## 7. Reviewer Documentation Follow-up (2026-11-13)

- [x] 7.1 Confirm the actual PR state from its timeline and reconcile current-state wording while preserving the historical draft-delivery/acceptance record. Explicitly mark superseded rollout tasks and describe the native fixed-container-to-ScrollView effect of all-environment availability.
- [x] 7.2 Check the documentation against existing source and review feedback, run strict OpenSpec/whitespace validation, and record the documentation-only verification exemption.


## 8. Shared-IP Email Send Quota (approved 2026-11-13)

- [x] 8.1 Reproduce the 31st-request rejection under the old ceiling, then raise only the per-IP/hour ceiling to 300 and reconcile its single-owner authentication delta.
- [x] 8.2 Verify 300th-request acceptance/301st rejection, shared-IP use by distinct addresses/devices and both purposes, unchanged remaining guards, and running local Redis/service behavior; record checks and limits.
- [x] 8.3 Complete local Bugs/Security/Compliance review and push the focused adjustment and evidence to PR #597, preserving its ready-for-review state.
