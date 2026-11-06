# Design

## Context

See `proposal.md` for the incident and scope. The isolated branch starts from fetched `origin/dev`, with Mobile 1.0.28 (801); the dirty primary checkout and the original diagnostic document remain untouched.

### Confirmed evidence and attribution limits

- The supplied 1.0.26 (797) crash names main executable UUID `917F213F-4341-3A25-A07A-EBF2817C2489` and a required libc++ symbol missing on iOS 16.6.1. It terminates in dyld before application initialization.
- The repository commit marking 1.0.26 (797) pins NitroModules 0.37.1 in both the package manifest and Podfile lock. This is source-history evidence, not proof of the precise Store build inputs.
- Installed Nitro 0.37.1 calls `std::make_exception_ptr` in `ios/utils/RuntimeError.hpp` from `ios/core/RuntimeError.swift`; `cpp/core/Promise.hpp` exposes another affected inline path.
- With Xcode 27.1, the same installed header and `-target arm64-apple-ios16.4`, implicit Swift modules produce neither incompatible import at `-Onone` or `-O`; explicit modules produce both at either optimization level. The resulting object still has `minos 16.4`.
- Applying the upstream exception-conversion implementation in a temporary probe removes both imports under explicit modules. This does not establish full-app runtime acceptance or cover Promise instantiations by itself.
- Current local Nitro Release settings enable explicit modules, Swift 5, and C++ interop, with deployment target 15.1. Neither 15.1 nor 16.4 selects the new branch in an ordinary C++ probe.
- Independent inspection found neither symbol in 21 current precompiled framework/static-library candidates. It does not prove the original build used the same inputs.
- The original 797 archive, object files, and link map have not been obtained. Do not report exact object-file attribution or a 796-to-797 toolchain change as confirmed.

## Goals / Non-Goals

**Goals:** Remove the reproduced native ABI incompatibility, retain native error/rejection behavior, and inspect the artifact that each existing delivery path actually produces.

**Non-Goals:** Raising the supported iOS floor; aligning every Pod target; supplying replacement libc++ symbols; disabling Swift explicit modules across the project; changing JS startup, authentication, storage, UI presentation, or remote publication. No general database of all newer Apple APIs is proposed.

## Decisions

### 1. Use the fixed stable Nitro release

Pin `react-native-nitro-modules` to 0.37.2 and lock its required `nitro-core` 0.37.2 dependency. The published package metadata confirms this split; the installed Google Sign-In 2.3.0 peer requirement accepts NitroModules >=0.36.0. Peer-range acceptance is not proof of native integration compatibility, so regenerate and build both affected platforms and exercise the existing Google Sign-In bridge.

Use the maintained upstream fix for both exception conversion and Promise destruction. Do not hand-edit installed packages or generated native projects. Regenerate tracked native outputs through Expo/CocoaPods. If package splitting breaks the approved integration, investigate the concrete failure before changing the implementation approach or adding another package.

Alternatives: a lower deployment target is experimentally insufficient; a libc++ shim creates additional ABI obligations; disabling explicit modules changes the build globally; a custom dependency patch duplicates a stable upstream correction.

### 2. Inspect required imports across the existing executable closure

Extend or reuse executable discovery in `tooling/ios-frameworks.mjs` and inspect undefined Mach-O imports with Apple tooling that distinguishes weak imports, such as `nm -m -u`. Match the two exact Mach-O symbol spellings in the delta spec, rather than broad substring matching. Keep diagnostics tied to the relative executable path and missing symbol.

Keep the import check distinct from the existing required-dylib closure check. Add tests for main, Share, framework, and dylib failures, a low-minimum-version binary with an incompatible required import, and weak imports. Avoid a general-purpose ABI framework or an expanding speculative blacklist.

### 3. Wire the same check into local and EAS delivery

Invoke the shared artifact validator from existing local archive/export/upload admission. Provide a focused entry point for validating an application bundle or an IPA without requiring local signing receipts.

For the existing production EAS profile, set an explicit iOS application archive path and invoke the shared IPA validator from `eas-build-on-success` only when `EAS_BUILD_PLATFORM` is `ios`. Require exactly the expected completed artifact instead of searching unrelated caches or accepting a missing artifact. Preserve the current Android hook behavior.

Expo's documented success hook runs at the end of a successful build. The current build-tools implementation awaits it inside the failure-propagating builder wrapper; a thrown hook error fails that build. The artifact may already have been uploaded to EAS storage, so the requirement is failed build status and no successful auto-submission candidate, not a claim that no bytes were uploaded.

Test the hook adapter locally with representative artifact inputs. A real remote EAS build is not authorized by this repair request; identify unverified hosted behavior explicitly.

### 4. Verify the actual Swift boundary and delivered behavior

Add a dedicated macOS/Xcode verification probe that compiles installed fixed exception/Promise paths with Swift C++ interop and explicit modules at iOS 16.4. Cover the upstream fixed core headers rather than preserving an obsolete installed-directory assumption after the package split. Verify required imports in the resulting objects and preserve error-message and unresolved-Promise behavior in a running host/native exercise where feasible.

Do not add native compilation to routine Mobile CI, whose contract excludes native builds. Routine tests cover parsers, traversal, failure propagation, and hook configuration; local verification covers compiler probes and native builds. Inspect a device-target Release output and record cold launch on iOS 16/17 when an appropriate runtime is available. Existing installed simulators are iOS 18.6 and 26.5; launching there does not establish old-system acceptance. Record a precise verification gap if an old-system target is unavailable.

## Risks / Trade-offs

- [Nitro package split changes native module discovery or headers] → Inspect the published dependency graph and generated Pods, then build and exercise the unchanged Google Sign-In bridge; include Android smoke/build verification.
- [A source probe passes while a different linked input still imports the symbols] → Inspect the final native artifact and all discovered executable images, including EAS output.
- [A broad symbol test rejects valid weak imports] → Distinguish weak undefined imports in parsing and test that case explicitly.
- [A local gate does not cover the cloud delivery used by production] → Use the same scanner in the EAS completion hook and retain a hosted-validation gap until exercised remotely under separate authorization.
- [Original build attribution remains incomplete] → Retain the supplied UUID and distinguish the reproduced dependency defect from an uninspected 797 object file.

## Migration Plan

After proposal review, upgrade and lock Nitro, regenerate native projects, implement and test artifact validation, and record verification in `validation.md`. Obtain the Mobile version decision after preparing and checking the change; the baseline is 1.0.28 (801), but recheck `origin/dev` before recommending the next build. Run the three local review passes, commit to this task branch, and open a draft PR targeting `dev`. Do not merge, sign for distribution, trigger EAS, submit to TestFlight, or publish to a store as part of this task.

If the dependency upgrade cannot pass integration checks, keep the draft work local while identifying the concrete incompatibility. A rollback of deployed binaries would require a separately verified compatible native build; JS OTA cannot repair the reported pre-main failure.

## Primary References

- [Nitro issue #1652](https://github.com/margelo/nitro/issues/1652)
- [Merged Nitro correction #1824](https://github.com/margelo/nitro/pull/1824)
- [Nitro 0.37.2 release](https://github.com/margelo/nitro/releases/tag/v0.37.2)
- [Published package metadata](https://registry.npmjs.org/react-native-nitro-modules/0.37.2)
- [Expo lifecycle hooks](https://docs.expo.dev/build-reference/npm-hooks/)
- [Expo success-hook failure propagation](https://github.com/expo/eas-cli/blob/main/packages/build-tools/src/builders/common.ts)
