# Proposal

## Why

Android users report that saving a WeChat article now brings Slax Reader to the foreground instead of returning directly to WeChat. The Expo share manifest generator omitted the legacy ShareActivity task-isolation attributes; restoring that source behavior removes an unnecessary context switch without changing collection transport.

## What Changes

- Restore the Android incoming-share activity's empty task affinity, exclusion from Recents, and single-task launch mode through the existing config plugin.
- Preserve the translucent native collection panel, authentication, URL/subject handling, request deadlines, cancellation, and result feedback without launching the React application.
- Extend existing manifest-generator tests for fresh and previously generated manifests, idempotence, and preservation of MainActivity configuration.
- Address the review-confirmed still-active popup regression: retire the previous popup with existing cancellation semantics and hand a copied new intent to a fresh standalone ShareActivity, with executable Kotlin handoff tests and real Android before/after verification.
- Regenerate the Android manifest through its owner and verify cold/warm source-app sharing, dismissal, consecutive shares, and existing Slax task preservation on Android.
- Keep TikHub investigation, backend provider changes, and failed-bookmark messaging outside this Android-only change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mobile-app-parity`: Make Android incoming-share task isolation and return-to-source behavior explicit within the existing incoming/outgoing sharing requirement.

## Impact

- Source owner: `apps/mobile/plugins/with-share.cjs`.
- Generated output: `apps/mobile/android/app/src/main/AndroidManifest.xml`, updated only through native generation.
- Tests: existing `apps/mobile/native/share/tests/plugin.test.cjs` and its current share-test entry point.
- Documentation: `docs/mobile/share.md` and this change's verification evidence during implementation.
- No new dependency, API contract, database migration, production write, or iOS sharing behavior change. This native configuration repair needs a rebuilt Android binary; it is not a JavaScript-only OTA fix.

## Review and Delivery Boundaries

On 2026-11-12, the requesting user confirmed the existing interaction: both Android and iOS open their own standalone collection popup, complete collection inside that popup, and do not foreground the main application screen. The user requested correcting the Android implementation only; this authorizes implementation of that restoration, not a new interaction or an iOS change. Preserve the popup throughout collecting, success, and failure; returning to the source after dismissal is a consequence, not a replacement for the popup. After explicitly authorizing uninstall/reinstallation, the user accepted the repaired local publisher-signed 1.0.29 (804) build on their Pixel 9 Pro Fold on 2026-11-12 and requested PR creation. No further UI adjustment was requested. Complete per-scenario task traces and a before/after recording remain undeclared by the user and are not claimed as agent evidence; see validation.md.

The task branch is `fix/android-share-task-isolation`, based on `origin/dev` at `8efef440`, and targets `dev`. The user explicitly approved Mobile `1.0.30` / build `805` / previous source build `804`; Android and iOS main/share/runtime metadata are regenerated together without changing iOS sharing behavior. Local signing and device installation were separately authorized and completed for acceptance; no merge, store upload, or public publication is authorized.
