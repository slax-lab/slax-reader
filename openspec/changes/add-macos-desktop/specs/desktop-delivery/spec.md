# Spec Delta

## Purpose

Define repeatable desktop commands, macOS verification evidence and controlled universal packaging while preserving repository branch and release policies.

## ADDED Requirements

### Requirement: Root command entry and independent checks

Desktop development, build, type checking, tests and packaging SHALL be callable from the repository root through `pnpm desktop -- <command>`. Pure core tests SHALL not require a desktop window. Invalid commands and unsupported application hosts SHALL fail with actionable usage information.

#### Scenario: Core tests

- **WHEN** a developer runs the documented core test entry
- **THEN** core policies are checked without launching a webview

#### Scenario: Unknown command

- **WHEN** a developer invokes an unsupported desktop command
- **THEN** the dispatcher fails clearly and does not execute an arbitrary shell command

### Requirement: macOS continuous integration scope

Desktop CI SHALL run on macOS for changes to desktop source, consumed shared reader/contracts/tooling, dependency locks and its own workflow. It SHALL check formatting/lints, core tests, generated IPC drift, frontend types/tests/build and an unsigned package smoke build. Pull-request checks SHALL not publish, notarize or require release credentials.

#### Scenario: Shared reader changes

- **WHEN** a pull request changes a shared resource consumed by desktop
- **THEN** desktop CI runs the affected checks

#### Scenario: Unrelated app change

- **WHEN** a pull request changes only an unrelated application with no desktop dependency impact
- **THEN** desktop CI does not run an unnecessary full native build

### Requirement: Native and reader evidence

Acceptance SHALL include installed-app native appearance/lifecycle evidence (B) and reader isolation/transport evidence (C), identified by app build, operating system and architecture. Mocked API tests and browser previews SHALL not substitute for native window/deep-link/isolation results. The original PowerSync proof A and remediation SHALL remain excluded as requested by the user.

#### Scenario: Native acceptance report

- **WHEN** a desktop build is proposed as feature complete
- **THEN** the report records window/menu/focus/appearance/accessibility cases and sandbox/frame/PDF transport cases with actual results

#### Scenario: Missing installed app evidence

- **WHEN** only mocked tests or a development browser have been exercised
- **THEN** the native acceptance task remains incomplete

### Requirement: Shared reader extraction preserves Mobile output

The shared-reader extraction SHALL land as a separate pure-refactor pull request before desktop consumes it. Mobile generated embedded resources, PDF bundle and resource/license manifests SHALL retain their complete pre-extraction bytes under the same frozen toolchain, and existing Mobile behavioral tests SHALL remain valid.

#### Scenario: Byte comparison fails

- **WHEN** a generated Mobile reader or PDF artifact differs after extraction
- **THEN** the extraction is not accepted as behavior-preserving until the discrepancy is resolved

#### Scenario: Desktop adds stricter host

- **WHEN** desktop implements its own frame adapter and content policy
- **THEN** the Mobile host adapter and generated output remain unchanged by that desktop-specific behavior

### Requirement: Universal packaging and update integrity

Packaging tooling SHALL produce Intel/Apple Silicon universal application artifacts and support local/preview/beta/main environments with desktop-specific identities. Preview SHALL map to the dev release channel; local SHALL have no publication or updater channel. Public distribution SHALL require the chosen signing/notarization and authenticated updater verification. Tampered, wrong-environment, wrong-channel or invalidly signed updates SHALL not install. Deferred minimum-OS and distribution choices SHALL remain explicit release gates.

#### Scenario: Invalid update

- **WHEN** an updater receives a tampered or wrong-channel artifact
- **THEN** installation is rejected and the current installation remains usable

#### Scenario: Release prerequisites absent

- **WHEN** the required final distribution decision or operator-managed signing configuration is unavailable
- **THEN** the release operation stops and does not publish an unverifiable artifact

### Requirement: Explicit desktop deployment environment

The `dev` command SHALL default to local loopback API/Web origins and the `build` command SHALL default to main. Both SHALL support explicit `:local`, `:preview`, `:beta` and `:main` suffixes. Build SHALL produce a packaged host-architecture application; advanced universal packaging SHALL remain available separately. An explicit local/preview/beta/main selection SHALL bind the origin pair, application identifier, credential namespace, data directory, fixed callback scheme and update identity. Remote builds SHALL use HTTPS; local builds SHALL use loopback origins. Invalid or partial origin overrides SHALL fail without falling back to another environment. The normal login UI SHALL open the selected environment's browser flow without an additional native enable switch, endpoint banner or setup notice. Application metadata and build artifacts SHALL identify the environment; remote API/Web enablement remains deployment controlled.

#### Scenario: Default local development

- **WHEN** a developer runs `pnpm desktop -- dev` without an environment suffix
- **THEN** the app selects local loopback endpoints, opens the normal local browser login flow and does not add environment/setup notices to the login screen

#### Scenario: Multiple environments installed

- **WHEN** local, preview, beta and main apps coexist
- **THEN** each owns separate credentials/data and its fixed callback scheme targets the corresponding app; a pending attempt from another origin pair is rejected

#### Scenario: Remote selection with a partial override

- **WHEN** only one member of the selected API/Web pair is overridden
- **THEN** tooling fails before compiling or launching a mismatched environment

### Requirement: Reviewed staged delivery

Each behavior-changing implementation pull request SHALL link its OpenSpec change, pass strict validation and required local review, and target dev. The separate login and reader-extraction scopes SHALL retain their own branches and pull requests. Changes SHALL be archived only after merge, and promotion/sync-back merges SHALL remain human operations under the repository release rules.

#### Scenario: Planning complete

- **WHEN** all proposal/spec/design/task files exist
- **THEN** the change is ready for human review and is not represented as an implemented application

#### Scenario: Implementation ready to push

- **WHEN** a behavior-changing patch is prepared
- **THEN** all required review passes and validations have completed and Important findings are resolved

#### Scenario: Default main build

- **WHEN** the developer runs `pnpm desktop -- build`
- **THEN** it packages the main environment application without publishing it, while `build:local`, `build:preview` and `build:beta` use their named profiles
