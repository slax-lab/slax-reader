# Tasks

## 1. Installation activation

- [x] 1.1 After proposal approval, inspect generated Chromium manifest resource declarations and host access; ensure explicit HTTP(S) scripting coverage in `apps/extension/wxt.config.ts` where missing, and verify the built manifest preserves existing file access, environment configuration, and unrelated permission scope.
- [x] 1.2 Add the scoped browser-service activation operation using HTTP(S) tab selection, a live `ContentScriptReady` probe, known manifest resource ordering, page CSS injection, and per-tab failure isolation; verify focused Vitest cases for ready/missing collectors, `undefined` probe responses, missing tab IDs/URLs, rejected injections, tab closure, and vendor-present/vendor-absent resources.
- [x] 1.3 Wire activation after readiness reset only for the first-install reason, independently of login and other install work; verify lifecycle tests cover install versus update/browser-update events, query failure, and preservation of menus/onboarding/session handling.

## 2. Regression and artifact verification

- [x] 2.1 Extend the existing extension test suite to verify no automatic collection, navigation, or reload, top-frame targeting, and reuse of a ready collector; run the focused suite and existing `collectReadiness.test.ts`, including authentication and PDF recovery coverage.
- [x] 2.2 Run `pnpm extension -- typecheck`, `pnpm extension -- test`, `pnpm extension -- build`, and `pnpm extension -- zip`; run the existing ESLint configuration on changed TypeScript files without auto-fixing unrelated code, inspect regular packaged resources and permissions, and record actual command results. Standard commands passed; the unchanged pre-existing `wxt.config.ts` import-order lint finding is recorded in `validation.md`.

## 3. Real-browser acceptance

- [x] 3.1 Confirm the requested Desktop built-in browser can load the regular unpacked extension in a disposable/test profile; if not, document the specific capability blocker and obtain an approved extension-capable environment rather than silently borrowing or uninstalling the user's regular Chrome extension. The change requester explicitly approved isolated Chrome on 2026-11-16 with mandatory profile deletion; the dedicated profile was deleted and absence of remaining processes was verified.
- [x] 3.2 Open a non-sensitive HTTP(S) article before genuine first installation, record an unchanged-document marker, then install the built artifact and verify the existing page's collector readiness, styling, and single host/sidebar before any collection action; record the actual install event and observations in `validation.md`.
- [x] 3.3 Invoke a real existing collection action on that same unrefreshed page and confirm normal feedback and the saved bookmark in the real configured service using an authorized test session; record browser/build, source-page continuity, and save result without credentials or private content. Do not mark complete on mock API or injection-only evidence.
- [ ] 3.4 Exercise multiple eligible tabs alongside a restricted page, a page opened after installation, logged-out collection, and existing PDF/file-access recovery; verify failures are isolated and record actual coverage and any unresolved gaps in `validation.md`.

## 4. Documentation and delivery checks

- [x] 4.1 Update `docs/extension/development.md` with the first-install/no-refresh smoke flow and permission scope; verify documented paths, resource behavior, and commands against the final implementation without editing generated instructions.
- [x] 4.2 Obtain and record the Extension version decision before handing off shipped code; apply only the approved version change and verify any resulting package metadata consistency using `docs/release/VERSIONING.md`.
- [x] 4.3 Run the Bugs, Security, and Compliance review passes from `REVIEW.md`, resolve Important findings, run `pnpm exec openspec validate --all --strict`, and check `git diff --check` plus `git status --short` for unintended/generated files; record the scoped review and verification results. No Important source findings. The requester approved version 1.16.4 and confirmed prior hands-on acceptance on 2026-11-16; the supplemental PDF coverage gap remains recorded in `validation.md`.
- [x] 4.4 Obtain human hands-on acceptance of the install/no-refresh collection behavior before any task PR, recording who accepted, when, and any adjustments in `validation.md`; do not treat automated or agent-driven browser evidence as that acceptance or archive before merge.
