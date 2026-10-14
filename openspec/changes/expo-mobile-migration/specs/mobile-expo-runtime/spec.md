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

The application SHALL distinguish a fully accepted migration release from an explicitly authorized preview. The historical preview-763 instruction confirmed `1.0.25 (762)` as the prior build and authorized publisher-signed TestFlight preview `1.0.25 (763)` without further tests, before remaining acceptance was complete. Its delivery receipt remains historical evidence. The subsequent PDF-correction/architecture request explicitly requires new tests and native motion verification and authorizes no additional publication or deployment. Historical build-761 Android/TestFlight delivery and its receipts remain unchanged. Preview delivery MUST retain unfinished acceptance and telemetry evidence as incomplete. The standalone `app.slax.reader.share` extension SHALL have no Firebase integration, configuration/linkage or Firebase admission requirement by explicit user decision; main-app Analytics/Crashlytics and their configuration, bootstrap, symbol-upload and release-admission checks SHALL remain intact. Main/share installation identities, App Group and matching version/build metadata SHALL be preserved. Release tooling SHALL use opaque authorized Apple signing/authentication without reading, printing or copying credential/private-key contents, and SHALL retain signed-artifact identity and fixture-exclusion checks. Publisher signing inputs remain operator-managed; an unsigned validation build MUST NOT be presented as a signed release. Backend deployment remains separately unauthorized: compatible deployed PDF APIs determine live feature availability but SHALL NOT be required to proceed with this explicitly authorized preview. Public App Store publication remains outside scope; upload and processing/availability SHALL be recorded separately.

#### Scenario: The user requests an early preview
- **WHEN** the user explicitly requests a TestFlight preview before full acceptance
- **THEN** the publisher-signed preview is uploaded with matching main/share identities and incremented build metadata
- **AND** unavailable native, performance and telemetry checks remain recorded as incomplete, not hidden as passed

#### Scenario: Share has no Firebase configuration
- **WHEN** the main app has its required Firebase integration and the standalone Share target has no Firebase integration or configuration
- **THEN** release admission does not require Share Firebase resources, bootstrap, linkage or telemetry
- **AND** main Analytics/Crashlytics checks and both bundles' identity, version, signature and App Group checks remain enforced

#### Scenario: Preview 763 is requested without further tests
- **WHEN** the user confirms build 762 and requests immediate TestFlight preview 763 without further tests
- **THEN** the signed main/share build uses `1.0.25 (763)` and records 762 as the user-confirmed prior bound without claiming remote history was independently queried
- **AND** no further test run or backend deployment is required for this preview, while incomplete acceptance and conditional PDF live availability remain explicit

#### Scenario: The accepted iOS release reaches TestFlight
- **WHEN** migration acceptance is complete and the authorized iOS archive/export succeeds
- **THEN** the exact validated build is uploaded to the existing TestFlight application
- **AND** evidence records the artifact identity/version, upload receipt and Apple processing/TestFlight status without treating a simulator build or an upload request alone as availability

#### Scenario: Signing or Apple processing is unavailable
- **WHEN** publisher signing, upload or Apple processing cannot complete
- **THEN** the validated local work and recoverable artifacts are retained
- **AND** the release task stays incomplete with the specific limitation recorded rather than publishing an unverified replacement

### Requirement: Distributed iOS previews use production configuration and complete native dependencies

TestFlight archive, export and upload admission SHALL reject non-production API, beta and Web environment overrides. Generated main/share metadata SHALL retain the established production API origins; inspected embedded JavaScript SHALL contain the production API and exclude the local-only `https://reader-api.slax.dev` test origin. Main Firebase admission and the Firebase-free Share target SHALL remain unchanged. CocoaPods SHALL reject a fallback to source artifacts when prebuilt React core or dependencies were requested. Archive/export admission SHALL verify required non-system dynamic dependencies across application, frameworks and extension executables before publication.

#### Scenario: A local test configuration reaches a release command
- **WHEN** archive, export or upload receives a test-origin override or stale test metadata/JavaScript
- **THEN** release admission fails rather than publishing a test-connected application
- **AND** explicitly configured local test builds remain available outside distribution commands

#### Scenario: A native artifact probe or packaging step drops a dependency
- **WHEN** requested prebuilt artifacts fall back to source mode or a required embedded dynamic library is missing
- **THEN** CocoaPods or archive/export admission fails with a dependency error
- **AND** recovery restores the supported dependency installation instead of patching installed packages or a signed application

#### Scenario: The reported startup crash is repaired
- **WHEN** corrected production build 766 is prepared after build 765's missing-library failure
- **THEN** production Release cold startup is exercised with embedded JavaScript and signed artifacts pass the environment/dependency checks
- **AND** upload, Apple processing, tester availability, provider login and physical-device verification remain distinct evidence

### Requirement: Mobile features have enforced responsibility boundaries

Following the approved post-763 correction, Mobile SHALL prioritize the main API/PowerSync credential-lifetime repair and stabilize PDF behavior before broad architecture refactoring. Credential work may proceed alongside unfinished native PDF correction without starting Phase 2. The subsequent refactor SHALL provide thin route composition, cohesive feature state/controllers and presentation, typed domain/data ports, and native/infrastructure adapters. Reader host geometry and format-specific rendering SHALL be separate from bookmark/comment/AI/overlay state; Library, settings/account, auth, RSS and payments SHALL retain explicit feature boundaries. Shared UI MUST NOT import screens or activate services, and presentation MUST NOT perform SQL, network/file I/O or global account transitions. Each asynchronous operation, subscription, timer and animation SHALL have one cancellation owner. Import/cycle checks SHALL enforce these boundaries using existing tooling.

#### Scenario: A feature is extracted from a large screen
- **WHEN** Reader or another mobile screen is split into modules
- **THEN** real behavior and account/document cleanup remain covered through its extracted controllers and components
- **AND** the change does not merely move unrelated responsibilities into one oversized hook or compressed presentation file

### Requirement: Current testing and generated guidance support the architecture

The post-763 follow-up SHALL add meaningful unit/component coverage using the current Node/TypeScript/React host conventions plus real-browser/native verification. Preview 763's no-further-tests exception SHALL NOT apply to this new work. Expo SDK, React Navigation and approved animation/data libraries SHALL remain unless separately authorized; optional test packages require an explicit dependency decision rather than an automatic framework migration. English mobile-scoped guidance SHALL be authored in `.rulesync/`, generated as `apps/mobile/AGENTS.md` with `pnpm agent:sync`, and included in drift checks, never hand-edited.

#### Scenario: Architecture and motion changes are delivered
- **WHEN** the integrated refactor is ready for acceptance
- **THEN** mobile check/bundle, affected native builds, original native PDF/interaction scenarios and generated-rule drift checks run on the deliverable
- **AND** mocks, skipped checks and missing live API evidence remain distinct from native or production acceptance

#### Scenario: A contributor updates mobile agent guidance
- **WHEN** responsibility, ownership or animation rules change
- **THEN** the mobile-scoped `.rulesync/rules/mobile-architecture.md` source and root repository map are updated and regenerated
- **AND** nested generated guidance is checked for drift without hand edits or new deployment/publication authorization
