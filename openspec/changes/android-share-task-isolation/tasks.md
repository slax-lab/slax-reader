# Tasks

## 1. Standalone Android Collection Popup

- [x] 1.1 Restore the three legacy task-isolation attributes in the share config plugin and extend the existing fresh/stale manifest regression tests; verify the focused share plugin suite passes and MainActivity configuration is preserved.
- [x] 1.2 Regenerate the checked-in Android manifest through the existing generator and update the Android share documentation; verify the diff preserves the translucent popup, transport, and iOS configuration.

## 2. Verification

- [x] 2.1 Run the standard Mobile check, bundle, native-resource checks, Android build, and strict OpenSpec validation; record exact outcomes and any unavailable prerequisites in validation.md without claiming blocked checks passed. Final versioned source checks pass; native acceptance/build provenance and the version-only increment are distinguished in validation.md.
- [ ] 2.2 Exercise the unchanged standalone popup with a controlled Android sender and real WeChat, with the main screen cold and backgrounded; verify collection remains in the popup, success/failure/dismissal and consecutive shares work, and main navigation state is preserved. Record human hands-on acceptance before opening the PR.

## 3. Delivery

- [x] 3.1 Obtain the human's explicit Mobile version/build decision, apply only approved metadata changes through their generators, and verify authoritative/native version consistency. Approved 1.0.30 (805), previous 804, on 2026-11-12.

Native acceptance status for task 2.2: the requesting user explicitly accepted the installed repair on Pixel 9 Pro Fold on 2026-11-12 and requested the PR. The detailed controlled-sender/cold/warm/error/cancel/consecutive-share matrix was not independently recorded, so that broader checkbox remains open with a declared evidence gap; it does not mean human acceptance is missing. See validation.md.
- [ ] 3.2 Complete local Bugs/Security/Compliance review, commit and push the isolated branch, open the dev-targeted PR with OpenSpec and verification evidence, and close the review loop; verify the PR URL and report any remaining checks without merging.
