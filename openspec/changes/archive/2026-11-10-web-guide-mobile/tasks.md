# Tasks

## 1. Responsive presentation

- [x] 1.1 Add page-local phone welcome typography, wrapping, and safe-area gutters in `guide.vue`; verify at 320px and 390px with Chinese and English text.
- [x] 1.2 Stack guide cards and fit images proportionally on phones; verify all three steps are visible by vertical scrolling without horizontal overflow at 320px, 375px, 390px, and 768px.
- [x] 1.3 Stack and size the existing footer actions within the phone viewport; verify signed-out and signed-in states retain their existing handlers and have at least 44px action height.

## 2. Verification and delivery

- [x] 2.1 Run Web lint, typecheck, unit checks, and build, plus `openspec validate --all --strict`; record actual outcomes and any existing failures in `validation.md`.
- [x] 2.2 Exercise the running page in Chinese and English across the declared widths, both footer states, and light/dark/e-ink; compare 769px and 1440px desktop layouts with the baseline and record screenshots outside Git plus observations in `validation.md`.
- [x] 2.3 Prepare the running preview for human hands-on acceptance, apply requested adjustments, reverify, and record who accepted, when, and what changed before opening a PR.
- [x] 2.4 Perform Bugs, Security, and Compliance review per `REVIEW.md`, resolve Important findings, and verify the final diff is limited to this change before pushing.

## 3. Owner-requested build metadata follow-up

- [x] 3.1 Increment Mobile buildNumber from 800 to 801 and previousBuildNumber to 800, retain version 1.0.28, regenerate native metadata through Expo, and verify matching Android/iOS main/share/runtime versions.
- [x] 3.2 Run Mobile verification checks appropriate to the metadata change and record outcomes and any gaps before committing and opening the PR.

Planning-only documentation is exempt from running-application verification. Implementation tasks remain unchecked until the proposal is approved and the implementation is exercised.
