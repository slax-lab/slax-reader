# Tasks

## 1. Scoped Native Repair

- [x] 1.1 Record human proposal review and implementation authorization in `proposal.md` before source edits; verify the record matches this change and work remains on the single main worktree's task branch.
- [x] 1.2 Add the small trusted-root directory resolver beside `InstallationDatabase.kt` and use it from both ownership entry points in `SlaxLegacyModule.kt`; verify it returns the expected canonical-root-based slot without changing ordinary/development lease behavior, database creation order, or installation binding checks.

## 2. Regression Coverage

- [x] 2.1 Extend the existing `installation-native-host.mjs` compilation and `installation-native-host.kt` fixture to execute the production resolver with canonical and aliased ancestor roots, missing/existing native slots, and a second user-root shape; verify the old guard fails the alias case and the repaired resolver returns the same canonical slot.
- [x] 2.2 Retain and extend the existing host checks for native/adopted records, missing established databases, invalid identities, linked database files, redirected files/database directories inside and outside the root, and mismatched files directories; verify rejection preserves synthetic target contents and never creates a replacement established database.
- [x] 2.3 Run `node apps/mobile/tests/data/installation-native-host.mjs` using installed public Kotlin/JSON prerequisites, plus `pnpm mobile -- check`, `pnpm mobile -- bundle`, `pnpm mobile -- test:native-resources`, and `pnpm mobile -- build:android`; record exact results or blocked prerequisites without substituting static assertions for native execution.

## 3. Running Android Verification

- [ ] 3.1 Exercise the rebuilt normal startup path in a controlled Android application process through first initialization, valid native/adopted reopen, cold relaunch, retry, and offline pending-write retention; verify it passes the former directory failure without using development-fresh mode to bypass ordinary admission, and record results in `validation.md`. Declared gap: the phone fresh install and cold relaunch passed; data-preserving legacy upgrade, queued-write retention/reconnect, and explicit retry remain unexercised.
- [x] 3.2 Obtain the Mobile version decision before implementation handoff, commit, or push; record the user's explicit authorization for uninstalling the old app after the signing mismatch was disclosed, and verify the repaired package before performing that destructive action.
- [x] 3.3 Perform the explicitly authorized uninstall and fresh installation of the verified repaired APK, then check startup and cold relaunch on the affected phone; record device/build and observed results in `validation.md`, distinguish fresh-install evidence from upgrade preservation, and leave authenticated hands-on testing to the user if login is required.

## 4. Review and Delivery

- [x] 4.1 Run the Bugs, Security, and Compliance passes from `REVIEW.md`, `pnpm exec openspec validate --all --strict`, and `git diff --check`; resolve Important findings and record the actual checks and any remaining verification limits.
- [x] 4.2 Obtain and record human hands-on acceptance of the restored Android saved-data flow before opening any pull request; verify the record identifies who tested, when, and what was accepted or adjusted.
- [ ] 4.3 After the task pull request merges, classify every remaining unchecked task and archive this change through a separate documentation pull request; verify the living compatibility specification receives the accepted delta without conflicting same-capability changes.
