# Tasks

## 1. Review and preparation

- [x] 1.1 Obtain human review of proposal, audit, design, and delta specs; record approval in the change notes before application edits.
- [x] 1.2 Complete frozen dependency installation and baseline Web/Extension checks using non-secret test configuration; record results and any existing failures without changing the lockfile.

## 2. Port the source behavior

- [x] 2.1 Port the table processor, registration, and scoped CSS; adapt and run the source table/integration tests, including fit/overflow transitions, cleanup, preserved table hierarchy, and existing outline-anchor regression checks.
- [x] 2.2 Port tag variants, the detail chip and interaction helper, call-site wiring, and overflow measurement; retain v2 import boundaries and verify the source tag/component tests pass for both list layouts and detail/topic contexts.
- [x] 2.3 Port Extension Shift+Enter handling and popup-host stacking; verify native caret insertion, explicit platform newline shortcuts, plain Enter/composition behavior, and a popup above a lower-stacking page banner.
- [x] 2.4 Reconcile the final application diff against all 23 audited paths and the 16 source commits; verify no obsolete shared-package imports, source CI/configuration files, or unrelated target changes were introduced.

## 3. Integration validation and review

- [x] 3.1 Run Web typecheck, tests and build; Extension compile, tests and build; and `pnpm design:check`; record exact results using the app manifests and root wrappers.
- [x] 3.2 Verify tag layouts and article tables in a real browser at narrow mobile, the 768px transition, and desktop widths; check light/dark/e-ink, keyboard focus, long labels, read-only state, compact overflow, and annotation/outline behavior, recording evidence and any unverified cases.
- [x] 3.3 Run `openspec validate --all --strict` and `git diff --check`; complete all Bugs, Security, and Compliance passes in `REVIEW.md` against `sync-legacy-frontend-develop`, resolving Important findings before pushing.

## 4. Delivery

- [x] 4.1 Update the audit with the final synchronization status, preserved v2 adaptations, and validation evidence; verify the source repository is unchanged.
- [ ] 4.2 When GitHub access is available, verify remote refs for additional changes, push the task branch, and create one PR targeting `dev` with `OpenSpec: sync-legacy-frontend-develop`, counts, exclusions, and validation results; attach the returned PR URL to this chat.
