# Mobile build and release

The current user-authorized preview delivery is `1.0.25 (761)`, following the successfully uploaded TestFlight build `760`: upload iOS to TestFlight, copy the signed Android App Bundle to Downloads, push Git and clean task-owned generated outputs. Main Android/iOS Firebase files and original Android signing inputs are supplied for opaque build-tool use. Full migration, native performance and standalone Share Firebase acceptance remain incomplete. This does not authorize public App Store/Google Play publication or backend deployment.

For this preview, generate native projects with `SLAX_MOBILE_VERSION=1.0.25`, `SLAX_MOBILE_BUILD_NUMBER=761`, and `SLAX_MOBILE_PREVIOUS_BUILD_NUMBER=760`, with all fixture modes disabled. Use Xcode's normal signed iPhoneOS archive/export-upload path and the existing account for team `8G3A932HJG`; retain identity, signature, App Group and matching main/share version checks. The strict Firebase-gated helper below remains the complete-release path and is not weakened to disguise the preview's missing integrations. Record the preview authorization, public artifact identity, upload result and remaining limitations separately. Build 758 references below describe the earlier complete-release procedure, not the current preview inputs.

Use the publisher's existing Xcode account and Keychain access through Apple's signing and upload tools. An operator supplies any missing account access, capabilities, service configuration, and StoreKit sandbox account locally. Agents do not inspect, print, copy, or commit credentials, signing keys, or service configuration files. A local signing-identity count does not establish that the account can sign these application identifiers; successful provisioned archive/export and Apple processing are separate evidence.

Development version defaults are not release versions. Determine the last published Android version code and iOS build number, then select a greater build number and the intended three-part marketing version. Export `SLAX_MOBILE_VERSION`, `SLAX_MOBILE_BUILD_NUMBER`, and `SLAX_MOBILE_PREVIOUS_BUILD_NUMBER` in the operator's shell. The previous-build input may also be an operator-confirmed upper bound on both previously published build numbers; record that distinction rather than inventing a publication history. Regenerate both native projects with the selected values before building. Main app and iOS share versions must match.

```sh
pnpm install --frozen-lockfile
pnpm mobile -- check
pnpm mobile -- bundle
pnpm mobile -- prebuild:clean
pnpm mobile -- pods
pnpm mobile -- build:ios --release --unsigned
```

The release script validates the explicit version inputs, monotonic build number, and regenerated native metadata. For this release, set `SLAX_MOBILE_VERSION=1.0.25`, `SLAX_MOBILE_BUILD_NUMBER=758`, and `SLAX_MOBILE_PREVIOUS_BUILD_NUMBER=757`. The last value records the prior-build upper bound, not a claim that build `757` was published. `--unsigned` creates a generic iOS simulator validation artifact. It does not establish the publisher signing identity, native crash delivery, payment behavior, installation upgrade, or publication readiness.

Final delivery requires a Release archive for generic iOS devices with the original `app.slax.reader` main app, `app.slax.reader.share` share extension, and `group.app.slax.reader` App Group. Main and share marketing/build versions must both remain `1.0.25 (758)`. The source's public development-team identifier is `8G3A932HJG`; actual signing and upload access must be established through the existing Xcode account. Export with Apple's `app-store-connect` method and explicitly disable automatic version/build-number management. Keep archive, local export, and upload as separate commands and evidence records so that a successful archive cannot be reported as a TestFlight upload.

After acceptance, set the public release inputs in the local shell. Choose fresh absolute output directories whose parents exist:

The archive command checks that its output volume has at least 6 GiB available before creating artifacts or starting Xcode. This is a minimum starting requirement, not a maximum build size; retain additional room for exports, temporary files, and simulator acceptance. Use a volume with sufficient space and preserve incomplete build reports if Xcode fails.

```sh
export SLAX_MOBILE_VERSION=1.0.25
export SLAX_MOBILE_BUILD_NUMBER=758
export SLAX_MOBILE_PREVIOUS_BUILD_NUMBER=757
export SLAX_APPLE_TEAM_ID=8G3A932HJG
pnpm mobile -- archive:ios --output /absolute/mobile-release/archive-run
pnpm mobile -- export:ios --archive /absolute/mobile-release/archive-run/SlaxReader.xcarchive --output /absolute/mobile-release/export-run
pnpm mobile -- upload:ios --archive /absolute/mobile-release/archive-run/SlaxReader.xcarchive --export /absolute/mobile-release/export-run
```

These commands use the existing Xcode account and Keychain without accepting credential files or arbitrary Xcode flags. They require a fresh output directory, verify the publisher-signed main/share identities and versions, reject fixture/simulator/ad-hoc artifacts, and save a separate `ios-release-report.json` per stage. Upload verifies the unchanged archive and local export, then asks Xcode to export and upload that archive. The local IPA hash identifies the inspected local export; it is not a claim about the bytes Apple receives from Xcode's subsequent export/upload.

After the signed archive and exported application pass their identity, entitlement, version, and fixture-exclusion checks, upload through Apple's existing account tooling. Preserve the upload receipt and check App Store Connect processing and TestFlight availability for `1.0.25 (758)`. A successful upload command alone does not prove that Apple accepted processing or that the build is available to testers. Unresolved signing, account, processing, or acceptance checks remain pending.

The subsequent worktree follow-up adds Android packaging. Use `pnpm mobile -- build:android --release bundleRelease --max-workers=1 --no-parallel --no-daemon` with fixture modes disabled and explicit version inputs; the root helper builds the Release APK and the forwarded Gradle task also creates `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab`. Signed packaging requires the existing operator-managed `SLAX_ANDROID_KEYSTORE_PATH`, `SLAX_ANDROID_KEYSTORE_PASSWORD`, `SLAX_ANDROID_KEY_ALIAS` and `SLAX_ANDROID_KEY_PASSWORD`; do not inspect or commit credential values. `--unsigned` is validation only, not installation or distribution. Preserve the original publisher identity rather than substituting Expo's debug key. Build 761's signed AAB is copied to `~/Downloads/SlaxReader-1.0.25-761.aab` and must survive subsequent task-output cleanup. The latest authorization includes TestFlight and Git delivery followed by cleanup; unit tests remain excluded by user instruction.

Firebase dependency resolution uses CocoaPods with static linkage because the installed React Native Firebase version rejects static linkage with its default SPM products. GitHub's `macos-26` runner supplies the selected Xcode line; see the [runner inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md). Future Firebase dependency changes must preserve the source extensions, configuration, screen reporting, and crash symbol workflow.

Every `archive:ios`, `export:ios`, and `upload:ios` command now requires configured native Firebase integration before starting a release stage. The operator must provide these local path inputs, with fixtures disabled and the approved release version inputs retained:

- `SLAX_MOBILE_FIREBASE_IOS_CONFIG`: an operator-managed iOS Firebase configuration appropriate for `app.slax.reader`.
- `SLAX_MOBILE_FIREBASE_SHARE_IOS_CONFIG`: an operator-managed configuration appropriate for the independent `app.slax.reader.share` Analytics integration. Do not assume the main app's configuration is valid for the extension. No separate legacy Share configuration has been located; the operator must resolve the intended Firebase registration/configuration.

The operator then runs `pnpm mobile -- prebuild:clean` and `pnpm mobile -- pods`. These existing generation tools install the supplied resources; agents must not open, parse, print, copy, synthesize, or commit service configuration contents. An environment flag alone is not release evidence. Admission inspects only regular-file presence for `ios/SlaxReader/GoogleService-Info.plist` and `ios/SlaxShare/GoogleService-Info.plist`, the public generated Xcode target resource/source membership and Release CocoaPods linkage, main AppDelegate initialization before React Native startup, the main Crashlytics symbol-upload phase, and the existing ShareCollector Analytics bootstrap. Share uses its own configuration through `FirebaseOptions(contentsOfFile:)`; it does not require an invented Share Crashlytics integration.

Admission also checks public application metadata for disabled telemetry and the main app's manual screen-reporting setting. Archived and exported main/share bundles must each contain a regular `GoogleService-Info.plist`; its contents are never parsed by release admission. The archive report records a hash of public native integration inputs, not configuration contents. Export and upload reject archives without matching admission evidence, including archives created before this guard; configure and create a fresh archive rather than patching an old signed artifact or report. Fixture generation and unsigned validation builds remain available without these operator configurations, but are not release-ready. These structural checks do not prove correct Firebase registration, event/crash delivery, or symbol ingestion; native acceptance remains required.

Before publication, complete the OpenSpec tasks and state ledger: source/new matched native renders, native back/swipe cancellation, old offline queue upgrades on Android/iOS, provider callbacks, share flows with the main app closed, StoreKit signed-offer/restore/revocation scenarios, and native crash/report delivery. Keep unavailable checks pending; do not count a bundle or unsigned simulator build as these checks.

`Mobile CI` runs static/fixture/bundle checks plus separate Android/iOS development builds on relevant changes. It has no signing credentials, account fixtures, store submission, or deployment step. The authorized TestFlight upload uses local Apple tooling after acceptance. Existing API deployment eligibility is unchanged: API/shared-contract/root dependency changes retain their original triggers, while mobile-only files do not trigger API deployment. CI build success is reported independently from device acceptance.
