# Tasks

These checked tasks record the merged predecessor implementation. Subsequent Web ordering and beta-policy changes are proposed and tracked only in `refine-email-login-flow/tasks.md`; this historical completion record does not claim that follow-up is implemented.

## 1. Method Row Presentation

- [x] 1.1 Curate the existing Google/Apple artwork and an installed-set envelope into the Web icon registry with provenance, paint, and decorative accessibility metadata; generate output through `pnpm icons:write` and verify `pnpm icons:check`, `pnpm icons:test`, and 20px rendering in all Web themes.
- [x] 1.2 Update `UserSignInMethodsSection.vue` to use leading icons, stacked name/status text, and trailing actions within complete method groups; verify the bound/unbound email, linked/unlinked provider, and expanded-email scenarios in the existing component suite.
- [x] 1.3 Apply explicit Web type roles and weights, at least 12px row padding, minimum 44px action hit areas, local responsive wrapping, and semantic theme styling; verify computed spacing, focus clearance, and no overflow in the running component at 1280px, 768px, 540px, and 320px.

## 2. Regression and Runtime Verification

- [x] 2.1 Run the existing component/page tests and add only missing behavioral/accessibility regressions required by the changed grouping; verify development binding/focus announcements and development/preview visibility and beta/production whole-section omission for both bound and unbound accounts, including the existing login-surface rollout tests.
- [x] 2.2 Run Web type checking, targeted lint, icon checks, diff whitespace checks, and `openspec validate --all --strict`; record exact results and any unrelated baseline failures in `validation.md`.
- [x] 2.3 Exercise the running account page with a local API fixture across light/dark/e-ink at 1280px, 768px, and 320px, plus the 540px layout transition; verify both locales, long addresses, busy/disabled states, errors, provider-unavailable notes, keyboard navigation, and successful email binding with the existing account preserved, and record observations and limitations in `validation.md`.
- [x] 2.4 Capture matched baseline/revised account cards from `c1e5aa84` and the implementation in the same state/theme/width; keep screenshots outside Git and prepare the before/after evidence for review.

## 3. Human Acceptance and Delivery

- [x] 3.1 Provide the implemented development preview for requester hands-on acceptance, apply any requested visual adjustments, re-run affected checks, and record who accepted, when, and what changed before opening a PR.
- [x] 3.2 Run the local Bugs/Security/Compliance review defined in `REVIEW.md`, resolve Important findings, and verify that only Web presentation/assets are affected; if CLI, Extension, or Mobile package output becomes affected, obtain its required version decision before commit, push, or handoff.


## 4. Expanded Form Follow-up

- [x] 4.1 Refine the account-binding variant of the shared email form to place input and send/verify actions side by side, with quiet labels and separate feedback; verify same-row controls, minimum hit areas, and no overflow at 1280px, 768px, and 320px in all Web themes and both locales.
- [x] 4.2 Re-run the affected account and login regression suites, type checking, targeted lint, strict OpenSpec validation, and browser email send/code/error/retry/success flow; capture revised expanded-form evidence and update `validation.md` before final hands-on acceptance.


## 5. Small-screen Refinement

- [x] 5.1 Apply the requested subagent design analysis to compact three-column method rows, quiet cancellation, responsive form alignment, and touch input sizing; verify visible same-row actions and no overflow at 320/360/375/390/540/768px plus desktop in both locales and all themes.
- [x] 5.2 Re-run affected account/login tests, type/lint/OpenSpec checks and browser form flows after the final adjustment; update evidence for final human hands-on acceptance tracked in task 3.1 before PR creation.


## 6. Email Login Presentation Extension

- [x] 6.1 After human review of the login extension and resolution of the optional demo choice, add the recognizable email entry and expanded identity/quiet-cancel header; verify both standalone and modal consumers preserve their existing provider order, gating, and cancellation behavior.
- [x] 6.2 Enable compact address/send and code/verify rows for the login consumer with login-appropriate sizing; verify 320px modal input space, labelled keyboard controls, feedback wrapping, and unchanged accepted account binding presentation.
- [x] 6.3 Run affected account/login tests, Web type checking, targeted lint, strict OpenSpec validation, and running-browser checks across both hosts/locales/themes/phone widths and a short modal viewport; record requests, outcomes, matched screenshots, and limitations in `validation.md`, then complete local review.
- [x] 6.4 Provide the implemented email-login preview for requester hands-on acceptance and re-verify requested changes before opening a PR; record who accepted, when, and what was adjusted.


## 7. Preview Test-profile Correction and PR Delivery

- [x] 7.1 Allow development and preview for Web email login and account methods while keeping beta/production hidden; reproduce the previous omission with regression tests, then verify the full account/login flows in both allowed profiles and disabled profiles.
- [x] 7.2 Reconcile the single existing authentication rollout delta, record both UI acceptances and final running-profile evidence, run required checks and local review, and prepare one email-optimization PR targeting dev with attached visual evidence.
