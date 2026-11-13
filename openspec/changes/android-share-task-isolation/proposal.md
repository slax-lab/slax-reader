# Proposal

## Why

Android users report that saving a WeChat article now brings Slax Reader to the foreground instead of returning directly to WeChat. The Expo share manifest generator omitted the legacy ShareActivity task-isolation attributes; restoring that source behavior removes an unnecessary context switch without changing collection transport.

## What Changes

- Restore the Android incoming-share activity's empty task affinity, exclusion from Recents, and single-task launch mode through the existing config plugin.
- Preserve the translucent native collection panel, authentication, URL/subject handling, request deadlines, cancellation, and result feedback without launching the React application.
- Extend existing manifest-generator tests for fresh and previously generated manifests, idempotence, and preservation of MainActivity configuration.
- Address the review-confirmed still-active popup regression: retire the previous popup with existing cancellation semantics and hand a copied new intent to a fresh standalone ShareActivity, with executable Kotlin handoff tests and real Android before/after verification.
- Regenerate the Android manifest through its owner and verify cold/warm source-app sharing, dismissal, consecutive shares, and existing Slax task preservation on Android.
- Ensure confirmed success finishes the Android popup in foreground, background, or locked-screen state without depending on an animation callback; locking alone does not cancel an in-flight request.
- Persist the actual result before UI feedback, add bounded finish/destroy lifecycle logs, and preserve these events through local export and the shared feedback-upload sanitizer. Add no document text or credential data to logs.
- Keep TikHub investigation, backend provider changes, and failed-bookmark messaging outside this Android-only behavior change. The shared feedback contract gains only an additive diagnostic-event allowlist entry, not a new endpoint or database migration.

On 2026-11-12, after accepting the previous task-isolation/repeated-intent repair, the user reported a locked-screen popup remaining visible after unlock and explicitly required success to always close and be logged. This later success-close correction is implemented under that instruction. At the user's direction, extended emulator testing was stopped and the normal production-configured, publisher-signed 1.0.30 (805) build was installed in place on the Pixel. The user then separately confirmed that acceptance passed without issues and requested updating the PR. This latest acceptance covers the success-close/logging correction; earlier acceptance remains historical. See validation.md for the exact APK hash and executed checks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-app-parity`: Android incoming-share task isolation, repeated-intent handling, and reliable successful closure across visibility and lock states.
- `mobile-diagnostic-log`: Bounded Android finish/destroy evidence, terminal-result persistence before UI feedback, and additive local/upload sanitization.

## Impact

- Native owners: `apps/mobile/plugins/with-share.cjs`, `ShareActivity.kt`, and `ShareDiagnostics.kt`.
- Generated output: `apps/mobile/android/app/src/main/AndroidManifest.xml`, updated only through native generation.
- Logging compatibility: Mobile diagnostic types/export filtering and `packages/contracts/src/feedback.ts`; the deployed feedback sanitizer must recognize the new optional event before uploads containing it can be accepted. No backend deployment is performed by this task.
- Tests: existing plugin, lifecycle, native diagnostic writer, export and feedback suites.
- Documentation: `docs/mobile/share.md` and this change's verification evidence.
- No new dependency, endpoint, database migration, production write, or iOS sharing behavior change. The native repair needs a rebuilt Android binary, not only a JavaScript OTA update.

## Review and Delivery Boundaries

On 2026-11-12, the requesting user confirmed the existing interaction: both Android and iOS open their own standalone collection popup, complete collection inside that popup, and do not foreground the main application screen. The user requested correcting the Android implementation only; this authorizes implementation of that restoration, not a new interaction or an iOS change. Preserve the popup throughout collecting, success, and failure; returning to the source after dismissal is a consequence, not a replacement for the popup. After explicitly authorizing uninstall/reinstallation, the user accepted the repaired local publisher-signed 1.0.29 (804) build on their Pixel 9 Pro Fold on 2026-11-12 and requested PR creation. The later 1.0.30 (805) repeated-intent correction was installed on the same phone, and the user explicitly reaffirmed that human acceptance was already complete and directed correction of the PR description. No further UI adjustment was requested. Human acceptance is complete, not waived or pending. The controlled emulator recordings and task traces are separate agent evidence; a full authenticated per-scenario transcript is not invented. See validation.md.

The task branch is `fix/android-share-task-isolation`, based on `origin/dev` at `8efef440`, and targets `dev`. The user explicitly approved Mobile `1.0.30` / build `805` / previous source build `804`; Android and iOS main/share/runtime metadata are regenerated together without changing iOS sharing behavior. Local signing and device installation were separately authorized and completed for acceptance; no merge, store upload, or public publication is authorized.
