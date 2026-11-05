# Tasks

## 1. Approval and Dependency Correction

- [x] 1.1 Record the human's review of this proposal before implementation; verify that the approved scope is present in `proposal.md`.
- [x] 1.2 Upgrade and lock NitroModules/nitro-core 0.37.2 through pnpm; verify the resolved dependency graph, both upstream fixed header paths, and the existing Google Sign-In peer/integration requirements without installed-package edits.
- [x] 1.3 Regenerate affected native projects and CocoaPods outputs through the existing generators; verify the generated dependency graph and review the diff for unrelated native configuration or signing changes.

## 2. Reproduced Compiler and Artifact Regression

- [x] 2.1 Add a dedicated local Swift/C++ explicit-module compatibility probe for the installed exception-conversion and Promise paths; verify the fixed output at the iOS 16.4 floor and demonstrate the known-bad case is detected using the reproduced old implementation in a temporary fixture.
- [x] 2.2 Add focused required-import parsing and executable traversal tests before implementing the scanner; verify failing tests cover the main executable, Share, frameworks, dylibs, low `minos` with incompatible imports, and weak imports.
- [x] 2.3 Implement the narrow shared compatibility scanner using existing executable discovery; verify the new tests pass and execute it against real compatible and known-incompatible Mach-O fixtures.
- [x] 2.4 Invoke the scanner from local release admission and a standalone app/IPA verification entry point; verify incompatible artifacts fail without weakening existing framework, signing, identity, and environment checks.

## 3. Actual EAS Artifact Coverage

- [x] 3.1 Configure the production iOS artifact path and platform-specific EAS success hook to use the same IPA scanner; verify fixture tests fail for an incompatible or missing expected artifact and preserve the Android hook path.
- [x] 3.2 Exercise the hook adapter locally against completed representative artifacts and record the upstream success-hook failure-propagation evidence; verify no remote build or store submission is initiated and any hosted-validation gap is explicit.

## 4. Integration Verification

- [x] 4.1 Run Mobile check/bundle and affected release tests, plus strict OpenSpec and whitespace validation; record exact results in `validation.md` and verify routine Mobile CI still excludes native builds.
- [ ] 4.2 Build an unsigned iOS Release validation artifact and inspect a device-target Release native output for both symbols; record artifact identity, toolchain, inspected executable coverage, and build limitations in `validation.md`. Gap: dependency Release archives succeeded, but full application packaging requires the absent operator Firebase resource.
- [ ] 4.3 Exercise cold launch and existing native error/Google Sign-In bridge behavior on available supported iOS targets; record iOS 16/17 evidence separately or declare the precise unavailable-runtime gap without claiming old-system acceptance. Gap: native launch/launcher and artifact inspection succeeded on iOS 18.6, but Mac screen lock blocked interactive opening and no iOS 16/17 target is available.
- [x] 4.4 Build and smoke the affected Android integration after the shared Nitro update; verify startup and existing bridge behavior or record the exact unavailable-environment gap.

## 5. Draft PR Delivery

- [x] 5.1 After preparing and checking the implementation, obtain the human Mobile version decision, apply any approved metadata change through generators, and verify all native versions and previous-build bounds agree.
- [x] 5.2 Run and resolve Bugs, Security, and Compliance local review under `REVIEW.md`; verify no Important finding remains and the evidence distinguishes probes, native runtime checks, and declared gaps.
- [ ] 5.3 Commit and push only this task branch, then open a draft PR targeting `dev` using the repository template and `OpenSpec: mobile-old-ios-launch`; verify the returned PR is draft, has the correct base, and links the verification record.
