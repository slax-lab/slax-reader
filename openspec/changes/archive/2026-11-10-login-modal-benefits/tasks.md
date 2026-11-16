# Tasks

## 1. Review

- [x] 1.1 Obtain human review of this proposal before implementation; record the decision in proposal.md.

## 2. Implementation

- [x] 2.1 Add the three localized benefits and the theme-aware panel to LoginModal using the reference spacing; verify the exact Chinese text, English equivalents, ordering, and decorative checkmark semantics in the running component.
- [x] 2.2 Preserve the existing provider controls and modal behavior; run the existing LoginModal regression tests and inspect the diff to confirm redirects and Apple availability are unchanged.

- [x] 2.3 Apply the user-authorized design conformance corrections for semantic typography/effects, secondary contrast, keyboard focus, reduced motion, safe areas, and the localized close label.

## 3. Verification and delivery

- [x] 3.1 Run the applicable Web typecheck, existing tests, build, and `openspec validate --all --strict`; record results and any explicit environment gaps in validation.md.
- [x] 3.2 Exercise the running modal in light, dark, and e-ink themes at desktop, 768px, and 320px widths, including a short mobile viewport and English wrapping; verify sign-in and close controls remain reachable and dismissal restores scrolling.
- [x] 3.3 Capture before/after screenshots in matched states outside git, show the implemented result to the user, and provide a running preview for human hands-on acceptance; record who accepted, when, and any resulting adjustments before opening a PR.
- [x] 3.4 Before pushing or opening a PR, refresh origin/dev, run the REVIEW.md Bugs, Security, and Compliance passes, resolve Important findings, and prepare the PR targeting dev with `OpenSpec: login-modal-benefits` and verification evidence.

- [x] 3.5 Re-run affected checks and browser verification after the design conformance corrections; update screenshots and record remaining verification limits.

## 4. Archive after merge

- [ ] 4.1 After the implementation PR merges, classify every remaining unchecked task and archive this change through a separate documentation PR; verify `openspec validate --all --strict` passes.
