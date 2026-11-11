# Proposal

## Why

Slax Reader 1.0.26 (797) aborts before application startup on the supplied iOS 16.6.1 device because its main executable requires `std::exception_ptr::__from_native_exception_pointer`, which the system libc++ does not export. Local experiments reproduce this import through NitroModules 0.37.1 and Swift explicit modules even with an explicit iOS 16.4 deployment target; checking deployment metadata alone cannot detect the defect.

## What Changes

- Upgrade the existing Nitro integration from `react-native-nitro-modules` 0.37.1 to the fixed 0.37.2 release, including its required `nitro-core` 0.37.2 dependency and generator-owned native dependency updates. Verify compatibility with the existing Google Sign-In integration rather than adding another authentication implementation.
- Cover both Swift-visible exception conversion and Promise destruction paths. Reproduce and verify the fix using Swift/C++ explicit modules at the approved platform floor.
- Reject the two reproduced incompatible required libc++ imports in the main executable, Share extension, embedded frameworks, and bundled dylibs. Apply the same check to local release admission and the actual EAS-produced iOS artifact; identify the executable and symbol on failure.
- Record native launch verification and its limits, including the distinction between a reproduced mechanism and attribution of the original build 797. Deliver one draft PR targeting `dev` after implementation, checks, version decision, and local review.

## Capabilities

### New Capabilities

- `mobile-ios-binary-compatibility`: Validate the known old-iOS libc++ exception-import regression across delivered native executables and both iOS delivery paths, including Swift/C++ explicit-module regression evidence.

### Modified Capabilities

None. The existing platform-floor, signing, account, and delivery-authorization contracts remain unchanged. This change does not add a delta to `mobile-expo-runtime`, which has other active changes.

## Impact

- Mobile dependency manifests and the shared pnpm lockfile; generator-owned CocoaPods/native outputs affected by the dependency update.
- Mobile release tooling, release tests, a macOS/Xcode compatibility probe, the iOS EAS completion hook, and focused release documentation.
- Android needs smoke/build verification because the Nitro dependency graph is shared. Web, Extension, CLI, backend APIs, database formats, and authentication behavior are outside the implementation scope.
- The fetched `origin/dev` baseline is Mobile 1.0.28 (801). Any application version/build increment requires the separate human decision required by `docs/release/VERSIONING.md`.

## Review Status

The owner approved implementation on 2026-11-05 by explicitly instructing implementation as proposed and requesting a bug review, verification, and a draft PR. Implementation is authorized in this worktree; The owner separately approved keeping version 1.0.28 and increasing build 801 to 802, with previous build 801.
