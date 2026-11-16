# mobile-ios-binary-compatibility Specification

## Purpose
Prevent the reproduced old-iOS libc++ exception-import regression from reaching delivered Mobile binaries, and preserve native error behavior on the application's already approved iOS support floor.

## Requirements

### Requirement: Native error paths preserve old-iOS compatibility

Native exception conversion and asynchronous error propagation SHALL remain compatible with the existing approved iOS platform floor, including code emitted through Swift/C++ explicit modules. The delivered code SHALL preserve error messages and rejection behavior without requiring the iOS 18-only exception construction symbols on supported older systems.

#### Scenario: Swift converts a native error on an older supported system
- **WHEN** a Release build using Swift/C++ explicit modules converts an error on iOS 16.4 or later
- **THEN** the exception remains available to the existing caller with its message preserved
- **AND** loading the application does not require the unavailable iOS 18 exception construction symbols

#### Scenario: An unresolved native Promise is destroyed
- **WHEN** an unresolved native Promise follows its existing destruction/error path on a supported older iOS system
- **THEN** its existing rejection semantics are preserved
- **AND** the Swift-visible template does not introduce the incompatible required libc++ imports

### Requirement: iOS artifact admission rejects the reproduced incompatible imports

Local iOS release admission and the production EAS iOS build completion path SHALL inspect the actual delivered main executable, Share extension, embedded framework executables, and bundled dylibs. They SHALL fail for required undefined imports of `__ZNSt13exception_ptr31__from_native_exception_pointerEPv` or `___cxa_init_primary_exception`, identifying the importing executable and symbol. A compatible minimum-system load command alone SHALL NOT satisfy this check. Weak imports SHALL NOT be classified as required imports. Failed EAS compatibility validation SHALL prevent a successful build result eligible for automatic submission.

#### Scenario: A binary has a low minimum system version and a new required import
- **WHEN** an executable reports a minimum iOS version of 16.4 but requires either incompatible symbol
- **THEN** admission fails and names that executable and symbol

#### Scenario: An embedded executable carries the incompatible import
- **WHEN** the main executable is compatible but the Share extension, an embedded framework, or a bundled dylib requires either symbol
- **THEN** admission fails for the importing embedded executable

#### Scenario: The regression is absent
- **WHEN** all inspected executables have no required import of either incompatible symbol
- **THEN** compatibility validation succeeds
- **AND** existing identity, signing, fixture exclusion, environment, and framework closure checks still apply

#### Scenario: The import is weak
- **WHEN** an inspected executable marks either symbol as a weak undefined import rather than a required import
- **THEN** this required-import rule does not reject it solely for that weak import

#### Scenario: An EAS artifact is incompatible
- **WHEN** the production iOS artifact contains either incompatible required import
- **THEN** the completion check exits unsuccessfully
- **AND** the build is not reported as a successful candidate for automatic submission
