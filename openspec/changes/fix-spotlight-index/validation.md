# Validation

Date: 2026-10-20. Branch: `feat/fix-spotlight-index`, based on `origin/dev` (`64c6b652`).

## Automated checks

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test apps/mobile/tests/system-actions/system-surfaces.test.mjs` | 17 passed, 0 failed. Includes new cases for not-ready preservation, resumption, explicit opt-out while not ready, and sign-out while not ready. |
| `pnpm mobile -- typecheck` | Passed. |
| `pnpm mobile -- check` | 1391 passed, 0 failed, 0 skipped. |
| `pnpm exec openspec validate --all --strict` | 71 passed, 0 failed. |
| `node --experimental-strip-types --test apps/mobile/tests/release/ios-release.test.mjs` | 27 passed, 0 failed. The admission accepts the scene-based AppDelegate while still rejecting missing or commented Firebase initialization. |
| `git diff --check` | Clean. |

## Simulator exercise

Target: iOS 27.1 Duo simulator (`4D5268D3-A4C0-4FD4-AA09-2E831A4C3AD0`), signed Release simulator build of `1.0.25 (777)`.

Configuration: `EXPO_PUBLIC_SLAX_API_URL=https://reader-api.slax.dev`, `EXPO_PUBLIC_SLAX_BETA_API_URL=https://reader-api.slax.dev`, `EXPO_PUBLIC_SLAX_WEB_URL=https://r.slax.dev`. The authorized test session was injected into the App Group preference store; its token is not recorded here or committed.

Verified:

- The app launched into the authenticated Inbox with synced bookmarks.
- The App Group surface state published the test account and `https://reader-api.slax.dev` as `catalogOwner` and 98 catalog bookmark ids.
- The native `dev.expo.appintents.plist` contained 98 catalog entries and `dev.expo.appintents.index.stale.bookmark` was false.
- CoreSpotlight logs reported `add-update-items:98` with `result: success`.
- After launching another app to background Slax Reader, the native catalog still contained 98 entries and the surface state still held the same owner and ids. This is the regression the change fixes; the previous code emptied the catalog in this situation.
- The app-target provider generated during the build contained both `ExpoAppIntentsModule` and `AppIntentsSetup`; extracted `Metadata.appintents` reported `BookmarkEntity` with `com.apple.appintents.entity.Indexed` and `OpenBookmarkIntent` with `com.apple.link.systemProtocol.OpenEntity`.

Not verified in the simulator:

- A hands-on article open and its native donation receipt. The simulator was run headlessly; no UI automation was available to tap a Library row. The donation controller is covered by the unit cases above, and native registration is confirmed by the generated provider and metadata, but a real `IntentDonationManager` receipt was not exercised here.
- Spotlight UI search and Shortcuts parameter UI. The CoreSpotlight daemon confirmed the 98 indexed items; system search UI availability is a separate, manually exercised surface. The change's WHEN/THEN evidence for catalog retention and indexing is the receipt above.
- TestFlight processing and tester availability; recorded separately after the upload stage.

## Release delivery

- Archive succeeded for `1.0.25 (777)` with main `app.slax.reader` and Share `app.slax.reader.share`, team `8G3A932HJG`, App Group `group.app.slax.reader`, verified signatures and Firebase admission version 2. The archive's extracted App Intents metadata reports `BookmarkEntity` with `com.apple.appintents.entity.Indexed` and `OpenBookmarkIntent` with `com.apple.link.systemProtocol.OpenEntity`; the generated provider includes `AppIntentsSetup`. Report: `/tmp/slax-777/archive/ios-release-report.json`.
- Export succeeded. IPA SHA-256: `7fe7b07301468d25dbd14b9950fa45391bdd1901bb1c30e39a22917c1a1d2523`. Report: `/tmp/slax-777/export/ios-release-report.json`.
- Xcode upload reported `Upload succeeded` and `Uploaded package is processing`; the local report records `testFlightProcessingConfirmed: false`. App Store Connect processing, processing completion and tester availability were not independently confirmed. Report: `/private/tmp/slax-777/export/upload-84bd9519-ea8a-4114-8c86-3dc7bff96bfe/ios-release-report.json`.
- The release admission was adapted to accept the scene-based AppDelegate bootstrap (`FirebaseApp.configure()` before either the classic factory start or `super.application`), because the iOS 27 template starts React Native from `SceneDelegate`. The focused release suite passes 26/26.

Pull request: https://github.com/slax-lab/slax-reader/pull/310

## Review

The local pre-push review (`REVIEW.md` Bugs, Security and Compliance passes) found no Important findings. The automated PR review's nits were addressed: the readiness test now emits during the paused window, the release admission requires the Expo SceneDelegate for the scene template, and the proposal/validation artifacts list the release-tooling changes.
