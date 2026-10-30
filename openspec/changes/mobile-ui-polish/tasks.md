# Tasks

## 1. Feedback presentation

- [x] 1.1 Obtain human review of the proposal and record the implementation decision before changing product code.
- [x] 1.2 Move Submit into the native header and remove redundant footer/dismiss controls; adapt the existing mounted header fixture and verify empty, whitespace, valid, pending, retry, ownership-invalid states, and unmount cancellation. Native Back interaction is covered by task 2.2.
- [x] 1.3 Reorder and relabel the consent rows and add the divider; verify English/Chinese labels, substituted email without surrounding brackets, independent defaults, and accessibility state props in the existing Feedback suite. Native wrapping/scaling is covered by task 2.2.
- [x] 1.4 Add outside-editor dismissal while preserving first-tap consent and Submit actions, text selection, and multiline editing; verify mounted dismissal and retain the installed ScrollView's native background-tap behavior. Task 1.11 supersedes consent-row dismissal; native keyboard/responder verification is covered by task 2.2.
- [x] 1.5 Confirm the More-panel tile and complete-item dimensions, then center the Pro badge at the tile's top with the original aspect ratio; run existing Reader menu regression coverage and include visual alignment in the owner's simulator acceptance.
- [x] 1.6 Apply the owner's Feedback refinements: keep attachment text unchanged when checked and shrink both circular icons to 12 points while preserving row touch targets; verify the existing consent regression tests and typecheck.
- [x] 1.7 Fill available screen height with the editor above bottom-anchored consent rows; verify short/long drafts with optional article context across keyboard-closed/open/restored viewport heights, keep existing Feedback tests green, and include native keyboard transitions in owner acceptance (task 2.2).
- [x] 1.8 Reduce Reader More-panel action icons from 28 to 24 points while preserving tile and badge geometry; run existing Reader regression coverage and include the visual size in owner acceptance (task 2.2).
- [x] 1.9 Apply the confirmed green hue to Mobile HTML/PDF caret styling; preserve the existing 40% CSS highlight and record the accepted iOS opacity limitation. The owner's later report showed that CSS alone did not recolor native selection; task 1.12 adds the native correction. Native appearance remains in task 2.2.
- [x] 1.10 Move comment-quote underlines below measured line boxes; verify wrapping, truncation, scaled/RTL line geometry, quote replacement, decoration states, and existing comment actions; retain native appearance checks in task 2.2.
- [x] 1.11 Preserve Feedback input focus and keyboard state when toggling either bottom option; retain background/Submit dismissal, verify independent toggles and draft retention, and include native focus/selection checks in task 2.2.
- [x] 1.12 Correct iOS native selection tint after the CSS-only attempt, match Overview prefix/content typography, and use the article mark color for popup quote lines; run affected checks and an iOS simulator build, then record the rebuild requirement and native acceptance gap.

## 2. Verification and acceptance

- [x] 2.1 Run the existing Feedback/diagnostic regression coverage, `pnpm mobile -- check`, `pnpm mobile -- bundle`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; record commands, outcomes, and any limitations in `validation.md`. The full check is not green; unrelated environment/configuration failures are recorded explicitly.
- [x] 2.2 Record native exercise and agent-verification coverage: the owner exercised the simulator, and an additional iPhone 16 / iOS 18.6 Feedback focus/consent check passed. `validation.md` declares unverified platform/locale/theme/keyboard combinations and the missing shareable before/after media; no full-matrix claim is made.
- [x] 2.3 Record the repository owner's hands-on acceptance on 2026-10-30 after their simulator iteration and latest UI refinements, before opening a PR; see `validation.md`.
- [x] 2.4 Ask for and record the Mobile version decision before committing, pushing, or handing off the implementation as ready; apply any approved increment through the existing version/native metadata tooling and verify generated output. On 2026-10-30 the owner chose to retain 1.0.25 (796).
- [x] 2.5 Complete independent and implementing-agent Bugs/Security/Compliance pre-push reviews: no Important findings or Nits. Preserve all five unrelated local edits outside the task commit.

## 3. Delivery and archive

- [ ] 3.1 After acceptance, open the task PR targeting `dev` with `OpenSpec: mobile-ui-polish`, recorded verification, and key visual evidence; close the review loop.
- [ ] 3.2 After the task PR merges, classify any unchecked tasks, reconcile the earlier diagnostic change's superseded feedback-presentation wording in the archive sequence, and archive this change through a separate docs PR; verify `pnpm exec openspec validate --all --strict` passes.
