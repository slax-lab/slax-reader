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

3. Review identified and real Android reproduction confirmed that a still-alive singleTask popup silently retained its first error when sent a second share. Handle `onNewIntent` by retiring the old request with the existing cancellation method, removing main-handler callbacks, finishing the old Activity, and launching a copied incoming Intent explicitly targeting ShareActivity. A fresh Activity owns the new diagnostics, executor, request lease, and UI. This avoids mutating the old Activity's intent while its executor is still using it and prevents its two-second success dismissal from affecting the replacement. No intent queue, new service, transport change, or main-app launch is introduced. Cancellation does not roll back a save already accepted by the server. Kotlin host tests execute the production handoff/cancellation methods; actual APK tests separately establish Android framework routing. Preserving the incoming flags is deliberate for this narrow regression repair: the replacement copies the share operation already delivered by Android rather than imposing a new sender-navigation or grant policy. The component is always replaced with the explicit ShareActivity target. The host test checks flag preservation, and the real framework regression used NEW_TASK and confirmed a separate share task and return to the source. Unusual MULTIPLE_TASK/CLEAR_TASK combinations and OEM behavior are not claimed covered. If a concrete flag combination causes a task-routing failure, normalize it in a separately verified change rather than adding an untested allowlist to this fix.

4. Validate the real Android lifecycle, not only manifest strings. Use a controlled sender that can supply the ordinary and NEW_TASK variants, then repeat the reported operation in WeChat. Test no main-app task, a background Library task, and a background Reader task. Capture resumed activities/task IDs before sharing, while the panel is visible, and after dismissal. Confirm the existing authenticated save succeeds once using a controlled non-production destination and that closing the panel returns to the sender.

5. The user clarified that locking is not cancellation: success must always end the popup and logs must be written. Record the result on the worker completion path before posting UI feedback; publish its state under the existing request mutex. Keep the foreground success display interval, but make its timer call a direct finish path rather than an animation end action. Track resumed state; success while not resumed, pausing after success, or resuming with completed success all finish directly. In-flight pause/lock does not cancel. The direct path removes callbacks, cancels animations, requests finish, and records the request; onDestroy records actual teardown and shuts down the diagnostic executor gracefully so queued writes drain. Existing explicit dismissal and new-intent replacement cancellation remain unchanged.

6. Reuse the bounded NDJSON writer: exactly one terminal result plus one `share.lifecycle` record for each fixed phase `finish_requested` and `destroyed`, with only share/launch IDs and success/finishing booleans. Sync terminal/lifecycle file descriptors on the writer thread, never block the main thread waiting for disk. Add narrow local and shared upload sanitizer rules so these records are not stripped or leaked. Preserve quota, line limits, redaction, and failure containment. OS process death or disk failure cannot be promised away; tests verify normal lifecycle teardown actually persists records and success is never overwritten by cancellation.

## Risks / Trade-offs

- Sender flags and OEM task behavior differ -> require WeChat reproduction on a representative Android device; do not claim the exact incident is reproduced from static inspection alone.
- `singleTask` can route another intent to an existing instance -> exercise consecutive shares after dismissal and record any still-active delivery observations before deciding whether lifecycle code needs a scoped correction.
- Native generation can update unrelated files -> inspect the generated diff and retain only task-owned changes; stop on missing operator inputs rather than inventing credentials.
- A source test cannot establish task-stack behavior -> require native build inspection and hands-on acceptance before PR creation.
- The fix changes native manifest metadata -> deliver through a new Android build, not OTA JavaScript; obtain the Mobile version decision before committing or handing off implementation.

## Migration Plan

After human proposal approval, implement and regenerate in this worktree. Run the focused plugin tests, the repository Mobile check and bundle commands, native-resource checks, and an Android build. Record actual device results and limitations in `validation.md`. Complete human hands-on acceptance and local review before opening the task PR against `dev`. Publication remains separately authorized. A rollback reverts the source attributes and regenerated Android output together; no user-data migration is involved.

## Resolved Delivery Decisions

- On 2026-11-12 the user approved Mobile 1.0.30 (805), previous source build 804, after the initial 804 acceptance. The later repeated-intent correction was built as 805 and installed on the same phone. The user explicitly reaffirmed completed human acceptance and instructed the assistant to correct the PR record. Human acceptance is complete; the prior pending label is superseded. No further UI adjustment was requested, and no unreported per-scenario observations are inferred.
- The accepted device is the user's Pixel 9 Pro Fold on Android 17 / API 37. The native APK was built, inspected, installed with explicit uninstall consent, and launched successfully. The user confirmed hands-on acceptance and requested the PR.
- Per-scenario cold/warm/error/cancel/consecutive-share observations, exact WeChat version, and a before/after recording were not independently recorded; validation.md discloses these evidence limits. No unperformed scenario is marked as passed.
