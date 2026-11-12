# Tasks

## 1. Standalone Android Collection Popup

- [x] 1.1 Restore the three legacy task-isolation attributes in the share config plugin and extend the existing fresh/stale manifest regression tests; verify the focused share plugin suite passes and MainActivity configuration is preserved.
- [x] 1.2 Regenerate the checked-in Android manifest through the existing generator and update the Android share documentation; verify the diff preserves the translucent popup, transport, and iOS configuration.

## 2. Verification

- [x] 2.1 Run the standard Mobile check, bundle, native-resource checks, Android build, and strict OpenSpec validation; record exact outcomes and any unavailable prerequisites in validation.md without claiming blocked checks passed. Final versioned source checks pass; native acceptance/build provenance and the version-only increment are distinguished in validation.md.
- [ ] 2.2 Exercise the unchanged standalone popup with a controlled Android sender and real WeChat, with the main screen cold and backgrounded; verify collection remains in the popup, success/failure/dismissal and consecutive shares work, and main navigation state is preserved. Record human hands-on acceptance before opening the PR.

## 3. Delivery

- [x] 3.1 Obtain the human's explicit Mobile version/build decision, apply only approved metadata changes through their generators, and verify authoritative/native version consistency. Approved 1.0.30 (805), previous 804, on 2026-11-12.

Human acceptance for task 2.2 is COMPLETE: the requesting user accepted the installed repair, approved 1.0.30 (805), and explicitly reaffirmed completed acceptance after the final 805 installation on Pixel 9 Pro Fold on 2026-11-12. No further UI adjustment was requested. The wider checkbox remains open solely because not every requested authenticated scenario has an independently recorded agent test transcript; it must not be treated as pending human acceptance. Controlled repeated-intent cases are complete under task 4.3. See validation.md.
- [ ] 3.2 Complete local Bugs/Security/Compliance review, commit and push the isolated branch, open the dev-targeted PR with OpenSpec and verification evidence, and close the review loop; verify the PR URL and report any remaining checks without merging.


## 4. PR Review Follow-up

- [x] 4.1 Reproduce review comment 4546502720 with the baseline APK in a read-only Android emulator; verify the second invalid share incorrectly retains the first error without any production request.
- [x] 4.2 Add the minimal onNewIntent handoff and execute the production Kotlin handoff/cancellation methods across collecting, success, failed, and dismissing states; verify 12 replacements preserve payloads and retire stale work.
- [x] 4.3 Build and install the corrected APK in the isolated emulator; verify consecutive invalid shares produce distinct fresh results, preserve task isolation, and return to the source. Re-run standard checks and record actual outcomes. Release build, four framework launches, 1,237 full-suite tests, and 11 focused tests passed; see validation.md.
- [ ] 4.4 Push the scoped follow-up to PR #586, respond to the Important finding with reproduction/fix evidence, and verify the automated review/check outcome without merging.
