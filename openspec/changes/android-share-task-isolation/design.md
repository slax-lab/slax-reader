# Design

## Context

See `proposal.md` for motivation and scope. `updateAndroidManifest` in `apps/mobile/plugins/with-share.cjs` currently sets only export and theme attributes on the share activity. The legacy Android manifest additionally used an empty task affinity, exclusion from Recents, and `singleTask`. The current `ShareActivity` is already a standalone native activity with direct network transport and no main-screen launch.

Android launch flags supplied by a sender influence task selection. The legacy/current manifest difference is established, but the reported WeChat intent flags and exact device behavior have not been captured. A design artifact is included to resolve the task-affinity choice and keep lifecycle verification explicit.

## Goals / Non-Goals

**Goals:** Restore legacy share task ownership at its source generator; preserve the user's existing main-app task and return-to-source behavior; prove regeneration is stable and the built native artifact has the intended attributes.

**Non-Goals:** Rework share networking or authentication, add a background service, alter main navigation, change iOS sharing, add dependencies, integrate a new content supplier, or repair failed-bookmark presentation.

## Decisions

1. Set `android:taskAffinity` to the empty string, `android:excludeFromRecents` to `true`, and `android:launchMode` to `singleTask` on the existing share activity in `updateAndroidManifest`. Retain the existing theme, exported status, class identity, and text/plain intent filter. Do not change MainActivity or application affinity. This restores the existing source model rather than inventing another task policy. Keeping default affinity would retain the observed regression risk; manual foreground/background navigation would add lifecycle coupling.

2. Apply the same attributes to an existing activity declaration and a fresh one. Extend the existing Node plugin suite for both cases, stale values, repeated generation, and unrelated main-activity preservation. Regenerate the checked-in Android manifest using the existing native-generation path, never a hand edit.

3. Keep `ShareActivity` behavior unchanged unless device verification demonstrates a defect directly caused by the restored flags. Verify a second share after the first has dismissed, including after cancellation or failure. Do not add speculative intent queues or concurrent-request machinery. An intent delivered to an activity that is still active is a separate lifecycle boundary to observe, not evidence that the user scenario has passed.

4. Validate the real Android lifecycle, not only manifest strings. Use a controlled sender that can supply the ordinary and NEW_TASK variants, then repeat the reported operation in WeChat. Test no main-app task, a background Library task, and a background Reader task. Capture resumed activities/task IDs before sharing, while the panel is visible, and after dismissal. Confirm the existing authenticated save succeeds once using a controlled non-production destination and that closing the panel returns to the sender.

## Risks / Trade-offs

- Sender flags and OEM task behavior differ -> require WeChat reproduction on a representative Android device; do not claim the exact incident is reproduced from static inspection alone.
- `singleTask` can route another intent to an existing instance -> exercise consecutive shares after dismissal and record any still-active delivery observations before deciding whether lifecycle code needs a scoped correction.
- Native generation can update unrelated files -> inspect the generated diff and retain only task-owned changes; stop on missing operator inputs rather than inventing credentials.
- A source test cannot establish task-stack behavior -> require native build inspection and hands-on acceptance before PR creation.
- The fix changes native manifest metadata -> deliver through a new Android build, not OTA JavaScript; obtain the Mobile version decision before committing or handing off implementation.

## Migration Plan

After human proposal approval, implement and regenerate in this worktree. Run the focused plugin tests, the repository Mobile check and bundle commands, native-resource checks, and an Android build. Record actual device results and limitations in `validation.md`. Complete human hands-on acceptance and local review before opening the task PR against `dev`. Publication remains separately authorized. A rollback reverts the source attributes and regenerated Android output together; no user-data migration is involved.

## Resolved Delivery Decisions

- On 2026-11-12 the user approved Mobile 1.0.30 (805), previous source build 804, after accepting the repaired 1.0.29 (804) Android binary. Only version metadata changed after acceptance.
- The accepted device is the user's Pixel 9 Pro Fold on Android 17 / API 37. The native APK was built, inspected, installed with explicit uninstall consent, and launched successfully. The user confirmed hands-on acceptance and requested the PR.
- Per-scenario cold/warm/error/cancel/consecutive-share observations, exact WeChat version, and a before/after recording were not independently recorded; validation.md discloses these evidence limits. No unperformed scenario is marked as passed.
