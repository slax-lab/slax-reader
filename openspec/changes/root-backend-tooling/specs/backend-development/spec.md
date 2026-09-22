## Purpose

Provide a single repository-root interface for backend development, configuration, validation, and operations, so maintainers can work without entering application directories and can verify that tooling relocation preserves existing Reader business behavior.

## ADDED Requirements

### Requirement: Complete repository-root command interface

The repository SHALL expose every supported backend development and maintenance operation through root package commands, including development and preview, generation, lint and formatting fixes, tests, Worker bundling, deployment, database inspection and migration, resource provisioning, logs, and existing maintenance utilities. Developers and CI MUST NOT need to change to an application directory, supply a package-directory forwarding option, or reference an application's installed CLI binary.

#### Scenario: Existing root command compatibility
- **WHEN** a maintainer invokes an existing root backend command with its supported arguments
- **THEN** it retains its operation, argument forwarding, exit status, and local-versus-remote semantics

#### Scenario: Former application-only operation
- **WHEN** a maintainer needs an operation previously exposed only by the backend application package
- **THEN** an equivalent, documented root command exists and runs using explicit repository-relative inputs and outputs

#### Scenario: Working directory is not disguised forwarding
- **WHEN** a supported root backend operation launches its normal tool processes
- **THEN** those processes use the repository-root working-directory contract rather than changing into the API package to recover implicit configuration
- **AND** explicitly isolated temporary workspaces used to prevent secret/configuration discovery remain permitted without becoming developer-facing entry points

### Requirement: Root-owned configuration interface

The repository SHALL keep authoritative development tool configuration at the repository root and deployment/environment configuration in root-owned deployment directories. Root configuration MUST NOT import an API-local configuration as its authority. Source, schemas, historical migrations, generated runtime types, and application tests SHALL remain associated with their application.

#### Scenario: Fresh checkout configuration discovery
- **WHEN** a maintainer installs dependencies at the root and invokes the documented generation, validation, or build commands
- **THEN** those commands select their root-owned configurations without requiring configuration files in the API package
- **AND** generated outputs and migration inputs resolve to the intended existing application paths

#### Scenario: Environment resource identity remains stable
- **WHEN** configuration is generated for each supported environment and Worker target after the relocation
- **THEN** Worker names, routing, service bindings, database bindings, queue consumers/producers, Workflow ownership, cron triggers, and compatibility settings retain their pre-relocation meanings
- **AND** development and local D1 migrations continue sharing the same local persistence location

### Requirement: Safe operation boundaries

The root command interface SHALL preserve the separation between offline validation, local environment initialization, and explicit remote operations. Validation MUST NOT provision resources, deploy Workers, mutate remote databases, or overwrite user credentials. Worker runtime type generation MUST NOT infer literal types from secret configuration.

#### Scenario: Offline build verification
- **WHEN** a maintainer runs offline configuration generation and Worker bundle checks
- **THEN** all requested artifacts are produced without remote deployment or provisioning
- **AND** the existing deployment dry-run remains configuration-only unless a separately named bundle operation is requested

#### Scenario: Local setup
- **WHEN** a maintainer requests local backend setup
- **THEN** setup targets only the documented local database/dependency environment, preserves existing data according to the current setup semantics, and does not start Worker servers or silently replace secrets

#### Scenario: Incomplete prerequisites
- **WHEN** an operation lacks required credentials, tool support, or external services
- **THEN** it reports the prerequisite or failure without silently switching to a different database or environment

### Requirement: Business-preserving relocation verification

Acceptance of the root-tooling migration MUST require before-and-after evidence from the same backend regression suite, actual four-Worker bundle output, and real local runtime requests. The migration SHALL preserve public request/response behavior, access controls, business data effects, and asynchronous dispatch semantics. Passing imports, compilation, or mocked tests alone MUST NOT be represented as end-to-end business verification.

#### Scenario: Existing business regressions
- **WHEN** the full backend test suite is run before and after tool relocation
- **THEN** no previously covered business tests disappear from discovery and no new failures are accepted
- **AND** pre-existing failures and skipped integration suites are reported separately rather than hidden or counted as passes

#### Scenario: Local runtime and persistence verification
- **WHEN** migrated root commands start the backend with isolated local test resources
- **THEN** actual HTTP requests verify gateway routing, authentication rejection, and authenticated bookmark write/read/delete behavior with persistence
- **AND** representative collection/access, subscription/payment, queue, and scheduled behavior is verified by the relevant existing regression or isolated integration tests

#### Scenario: External integration cannot be verified
- **WHEN** required local runtime prerequisites or cloud/provider integrations are unavailable without additional authorization or credentials
- **THEN** the exact unverified scenarios and blocking prerequisites are reported
- **AND** the migration is not claimed to have complete business acceptance until the required scenarios are verified

### Requirement: Consistent documentation and automation

Repository documentation, CI, and contributor guidance SHALL use the same root command and configuration interface. Application-local commands SHALL NOT remain as required steps in an otherwise root-based workflow.

#### Scenario: CI reproduces developer workflow
- **WHEN** CI generates clients and configuration, checks code, runs tests, and bundles Workers
- **THEN** it invokes supported root commands without setting an API-package working directory

#### Scenario: Command migration is discoverable
- **WHEN** a maintainer follows an old backend operation to the updated documentation
- **THEN** the root command equivalent, configuration locations, prerequisites, and remote-operation risks are documented
