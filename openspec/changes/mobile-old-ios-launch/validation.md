# Validation

## Scope and Decisions

The owner approved the proposal on 2026-11-05, requested independent bug review and a draft PR, and approved keeping version 1.0.28 with build 802 and previous build 801. Implementation is isolated on `fix/mobile-old-ios-launch`, based on fetched `origin/dev`. There are no UI presentation, authentication-flow, storage-format, signing-policy, or platform-floor changes.

NitroModules is pinned to 0.37.2 with its required nitro-core 0.37.2 dependency. `pnpm peers check --filter @apps/slax-reader-mobile` reports no peer issues. Expo prebuild and CocoaPods generated the native version/dependency changes. An unrelated unconfigured-Firebase Podfile regeneration was discarded; the tracked Firebase bootstrap and admission requirements remain intact.

## Automated Checks

- `pnpm mobile -- check`: passed 1,279 tests, zero failures/skips, before the version-only regeneration. Architecture/source/fixture verification and TypeScript passed.
- On build 802, a full check passed 1,278 tests but one existing Kotlin transport compilation timed out at 120 seconds while native builds were running. The same `android-transport.test.cjs` passed when run separately. A subsequent full test run with `--test-concurrency=2` passed all 1,279 tests, zero failures/skips.
- After adding the discovered root-dylib regression, all 42 release tests passed, zero failures/skips. The final full 1,280-test run passed 1,278 with two timing-related failures: `pdf-browser.test.mjs` timed out waiting for page 13 text, and the Kotlin transport fixture measured a partial-header failure earlier than its expected deadline window (6,617 ms versus 7,700–9,300 ms). Neither test nor its underlying PDF/HTTP implementation changed in this diff. Subsequent isolated runs passed all four PDF-browser tests and the Kotlin transport test (36 runtime scenarios). These retries do not erase the two failures in the full run or constitute a claim that the final full run was green.
- `pnpm mobile -- bundle`: Android and iOS Hermes bundles exported successfully on build 802.
- `openspec validate --all --strict`: 108 items passed, zero failed; pre-existing informational notices remain outside this change.
- `git diff --check`: passed.

Initial environment repairs did not change product code: the existing Kotlin compiler was added to command-scoped PATH; Android used the existing cached JDK 17 and a temporary repository-order init script after remote TLS/cache failures. CocoaPods completed after transient public Git downloads were retried with command-scoped HTTP/1.1. No dependency source or generated project was hand-patched.

## Reproduced Compiler Regression and Runtime Behavior

`pnpm mobile -- test:ios-compatibility-host` passed with Xcode 27.1 / iPhoneOS 27.1 SDK, Swift 5 and C++20 interop, target arm64 iOS 16.4:

| Implementation | Explicit modules, no optimization | Explicit modules, Release optimization |
| --- | --- | --- |
| Reproduced old exception helper | Both incompatible required imports detected | Both incompatible required imports detected |
| Installed Nitro 0.37.2 exception/Promise paths | Neither incompatible import | Neither incompatible import |

All four objects report minimum iOS 16.4, demonstrating why deployment metadata alone is insufficient. The old implementation is only a temporary diagnostic fixture; installed dependencies are unchanged. A running C++ host using the installed headers preserved the exact exception message and invoked the existing rejection callback when a pending `Promise<double>` was destroyed.

The same probe exercised real Mach-O objects inside IPA fixtures through both the standalone scanner and the EAS adapter: the known-bad IPA failed and the corrected IPA passed. The standalone CLI also inspected the corrected IPA successfully. The actual Android EAS hook command returned `{"skipped":"android"}`. The actual iOS hook command failed for an absent configured artifact rather than silently succeeding.

Local probe evidence remains under the task's `slax-nitro-compatibility-host-VlWTeg` temporary directory. These compiler and host results do not establish iOS 16/17 full-app acceptance.

## Native Integration

### Android Release and Cold Launch

An ARM64 unsigned Release build succeeded using JDK 17 and Android SDK 37, including the upgraded NitroModules and existing NitroGoogleSignin native targets. Package inspection confirms `com.slax.reader`, version 1.0.28, build 802, minimum API 26. The unsigned APK SHA-256 is `89fb13414f37588881a2117202174d3d01e959bcf3e566fc169f474db2784db8`.

For runtime verification only, a copy was signed opaquely with the existing generated fixture development key and installed on a newly created task-owned Android 15 / API 35 emulator. This is not a publisher-signed artifact and was not uploaded. Two cold launches reached the normal Welcome/Login screen with the Google sign-in entry; the process remained alive and no application AndroidRuntime fatal exception was observed. A temporary System UI responsiveness dialog under build load was dismissed before the successful second launch. No real account sign-in was performed.

### iOS Device-Target Native Release

The `NitroGoogleSignin` scheme in the generated Pods project built successfully for generic iOS devices in Release with signing disabled, including NitroModules. Both resulting archives have zero required imports of the two incompatible symbols:

| Artifact under `apps/mobile/ios/build/Release-iphoneos/` | SHA-256 |
| --- | --- |
| `NitroModules/libNitroModules.a` | `ba59a6706ddb233f6caff4d72977d5d3e6c2182ce5369e6841128f9e3401c042` |
| `NitroGoogleSignin/libNitroGoogleSignin.a` | `acf21885b9294e7c009951b66aa91218f04d252a8d57c2a5c90db85f1e522695` |

The full unsigned main-app device Release attempt failed at copying the required operator-owned `GoogleService-Info.plist`, which is absent in this isolated checkout. This is a declared verification gap, not a successful app Release build. No configuration contents were opened, copied, or synthesized, and no release/Firebase gate was bypassed.

### iOS Simulator Build and Artifact Inspection

The existing controlled fixture generator created a separate `app.slax.reader.uifixture.ioscompat` application with synthetic library data and no production Firebase/App Group configuration. Its arm64 Debug simulator build succeeded, including the upgraded native dependencies. A first generic simulator build was deliberately stopped to avoid compiling the unused x86_64 slice; only the resumed arm64 build is claimed successful.

Scanning the actual built app checked 19 executable images, including `SlaxReader.debug.dylib` and `__preview.dylib` at the application root, and found neither incompatible required import. The empty preview dylib produces Apple's normal nm `no symbols` diagnostic.

Inspection of this real bundle revealed that executable discovery originally missed root-level debug dylibs. A new regression test first failed with a missing expected exception; discovery was corrected and the test passed. This closes the concrete main-code scan omission without changing runtime code or widening the forbidden-symbol list.

The iOS 18.6 simulator accepted installation and a direct native launch returned a live application PID. Interactive deep-link opening initially stopped at the system Open confirmation, and Mac screen lock prevented computer-use access to confirm it. A follow-up screenshot confirmed the native Expo Development Build launcher was running behind the Open confirmation; the library React screen did not render. Interactive UI/JavaScript startup remains a declared gap. A native launch PID or launcher screen is not represented as successful React screen rendering.

## Independent Review

A fresh reviewer completed Bugs, Security, and Compliance passes against `mobile-old-ios-launch`, independently ran the focused compatibility tests, and found no Important findings or Nits. It verified the EAS output path and awaited-hook error propagation against Expo's primary implementation. The same reviewer completed the final incremental Bugs/Security/Compliance review of generated metadata, the root-dylib correction, and the verification record: no Important findings and no Nits. It independently passed seven compatibility/discovery/closure tests, verified both device Release archive hashes and imports, and confirmed version 802 consistency. The ExpoModulesCore-only spec checksum drift is generator-derived (the generated spec includes absolute worktree source paths); version and dependency declarations are unchanged. No signing or Firebase admission weakening was found. The two late full-suite timing failures and successful isolated reruns are recorded above; their unchanged implementation surfaces were checked separately.

## Remaining Verification Gaps

- Full main-app iOS Release packaging requires the operator Firebase resource missing from this worktree.
- No iOS 16/17 runtime or physical device is available locally; newer-simulator and compiler evidence do not replace old-system cold-launch acceptance.
- Complete Google provider authentication, configured production Firebase behavior, and hosted EAS execution/automatic submission were not exercised. Native bridge compilation and Android Login rendering are narrower evidence.
- Original build 797's matching archive/object files are unavailable. The supplied missing-symbol failure and reproduced Nitro defect are established, but exact original object-file attribution and a 796-to-797 toolchain change are not claimed.
- No publisher signing, EAS build trigger, TestFlight/store submission, deployment, or merge has been performed.

## Retained Outputs

Task-owned native artifacts, compiler evidence, and logs remain available while full iOS packaging/old-system verification is pending. No global caches or another task's artifacts were removed. The development-signed Android smoke copy is not a distribution deliverable.

## Draft Delivery

Implementation commit `b575a66d` was pushed on `fix/mobile-old-ios-launch`. [Draft PR #523](https://github.com/slax-lab/slax-reader/pull/523) targets `dev`; GitHub returned `isDraft: true`, `state: OPEN`, and the expected head/base. The body uses the repository template, includes `OpenSpec: mobile-old-ios-launch`, links this record, and preserves the incomplete integration tasks and final-suite failures. Initial CI jobs were queued and automatic review was skipped for the draft; no remote review feedback was present at creation.
