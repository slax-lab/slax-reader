# Mobile Expo Runtime Spec Delta

## Purpose

Make the complete mobile application buildable and maintainable inside the monorepo with explicit dependency consent and reproducible native development commands.

## ADDED Requirements

### Requirement: Mobile has a stable monorepo entry point

The repository SHALL provide the mobile application under `apps/mobile`, with its implementation, assets, native integrations, configuration, and tests owned by that application. Contributors SHALL be able to invoke its documented development, type-check, test, Android build, and iOS build commands through `pnpm mobile -- <command>`. Mobile SHALL consume public shared contracts without depending on Web, Extension, or API application internals.

#### Scenario: Contributor works on mobile alone
- **WHEN** a contributor follows the mobile development guide
- **THEN** the documented root commands resolve the mobile workspace package
- **AND** preparing or checking mobile does not start other applications or deploy remote services

### Requirement: Mobile supports the approved platform floor

The application SHALL use the user-approved Expo SDK 57 runtime and support Android API 26 or later and iOS 16.4 or later. Both platforms SHALL have native development and release build paths; successful JavaScript bundling alone MUST NOT establish native build completion.

#### Scenario: Native builds are verified
- **WHEN** migration acceptance is evaluated
- **THEN** both Android and iOS applications are built and launched on supported native targets
- **AND** the recorded evidence identifies runtime versions and device or simulator versions

### Requirement: Optional integrations require specific user consent

Before installing, declaring, importing, or configuring any additional optional plugin, the migration SHALL identify its package names, purpose, and native implementation implications and obtain explicit user approval. Approval SHALL be recorded by integration group. A declined or unanswered request MUST NOT be treated as approval. The existing approved navigation, reading-container, and offline-database groups SHALL not require repeated approval.

#### Scenario: A new integration is proposed
- **WHEN** a plugin outside the recorded approved groups could supply a required feature
- **THEN** the contributor asks the user about the specific plugin before adopting it
- **AND** independent approved migration work remains available to continue

#### Scenario: A plugin does not reproduce source behavior
- **WHEN** an approved plugin lacks a required source capability
- **THEN** a project-owned native implementation preserves that capability
- **AND** the feature is not silently removed or replaced with a simpler flow

### Requirement: Mobile changes preserve existing repository operations

Mobile source-only changes SHALL receive appropriate mobile checks and SHALL remain outside existing API source deployment paths. Changes to shared contracts or root package, lock, or workspace manifests SHALL retain the existing API release eligibility. Mobile commands SHALL distinguish local preparation, offline verification, and explicitly authorized release operations.

#### Scenario: A mobile source-only pull request is checked
- **WHEN** only mobile implementation and mobile documentation change
- **THEN** mobile CI verifies the affected application
- **AND** that source-only change does not initiate API deployment

#### Scenario: The shared workspace lockfile changes
- **WHEN** mobile dependency work also changes a root dependency manifest or lockfile
- **THEN** existing repository checks and release eligibility remain in force
- **AND** mobile development documentation explains that shared-root coupling

### Requirement: Migration provenance includes the actual source tree

Migration SHALL preserve the source repository and account for its audited working-tree modifications and untracked production files, including RSS. Source commit, included paths, content checksums, transformations, and current platform gaps SHALL be recorded without copying secret files or claiming that committed HEAD alone represents the baseline.

#### Scenario: An existing feature resides in an untracked source file
- **WHEN** a production RSS or reader file is present in the audited source working tree
- **THEN** it is included in the migration inventory and parity checks
- **AND** source files, branches, and configuration remain intact


### Requirement: Final release delivery follows the authorized TestFlight scope

The application SHALL distinguish a fully accepted migration release from an explicitly authorized preview. The user authorized immediate TestFlight preview delivery of `1.0.25 (759)` following uploaded build `758`, without waiting for full parity acceptance or Firebase configuration. Preview delivery MUST retain the incomplete acceptance and telemetry status rather than certify it as complete. Main/share installation identities, App Group and matching version/build metadata SHALL be preserved. Release tooling SHALL use opaque authorized Apple signing/authentication without reading, printing or copying credential/private-key contents. Android development verification remains required for full migration acceptance; no Android release package is required for this delivery. Public App Store publication and production backend operations remain outside this authorization.

#### Scenario: The user requests an early preview
- **WHEN** the user explicitly requests a TestFlight preview before full acceptance
- **THEN** the publisher-signed preview is uploaded with matching main/share identities and incremented build metadata
- **AND** unavailable native, performance and telemetry checks remain recorded as incomplete, not hidden as passed

#### Scenario: The accepted iOS release reaches TestFlight
- **WHEN** migration acceptance is complete and the authorized iOS archive/export succeeds
- **THEN** the exact validated build is uploaded to the existing TestFlight application
- **AND** evidence records the artifact identity/version, upload receipt and Apple processing/TestFlight status without treating a simulator build or an upload request alone as availability

#### Scenario: Signing or Apple processing is unavailable
- **WHEN** publisher signing, upload or Apple processing cannot complete
- **THEN** the validated local work and recoverable artifacts are retained
- **AND** the release task stays incomplete with the specific limitation recorded rather than publishing an unverified replacement
