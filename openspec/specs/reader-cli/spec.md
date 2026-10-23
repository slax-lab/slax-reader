# reader-cli Specification

## Purpose
Provide a standalone-installable Slax Reader command-line client maintained in the monorepo, with compatible bookmark and authentication commands, reproducible developer workflows, and a narrowly scoped public agent skill.

## Requirements

### Requirement: Standalone package identity and distribution

The CLI SHALL remain installable as `@slax-lab/reader-cli` and expose the `reader-cli` executable independently of a monorepo checkout. Its distributable SHALL include the built executable and applicable license information, preserve the imported MIT attribution, identify the monorepo application as its source, and require no private workspace runtime package. Package metadata and prerequisites SHALL declare Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` rather than claim Node.js 18 compatibility.

#### Scenario: Install the packed application outside the workspace

- **WHEN** a consumer on a supported runtime installs the archive packed from `apps/cli` into an isolated directory outside the monorepo
- **THEN** the installed `reader-cli --version` reports the package version and `reader-cli --help` lists the migrated commands
- **AND** execution does not resolve application code or private runtime dependencies from the source checkout
- **AND** the archive includes the executable and the CLI's license attribution

#### Scenario: Read runtime and repository metadata

- **WHEN** a consumer inspects the CLI manifest and installation prerequisites
- **THEN** they identify the monorepo `apps/cli` source and the supported Node.js range consistently
- **AND** the npm package name and binary name remain unchanged

### Requirement: CLI-only developer workflow

The monorepo SHALL expose `pnpm cli -- <script> [arguments]` for the CLI's build, typecheck, test, development and built-executable start scripts. The dispatcher SHALL forward arguments without shell reinterpretation and preserve process exit and termination status. CLI workflows SHALL require neither unrelated application environment files nor running API/Web/Extension services. CLI dependencies SHALL be reproducibly installable through the root frozen lockfile.

#### Scenario: Build and execute from a fresh checkout

- **WHEN** a developer runs root `pnpm install --frozen-lockfile`, `pnpm cli -- typecheck`, `pnpm cli -- build` and `pnpm cli -- start --help` without local deployment configuration
- **THEN** the CLI typechecks, builds and prints executable help without starting another application

#### Scenario: Dispatcher usage and forwarding

- **WHEN** a developer requests dispatcher help, supplies an unknown script, or passes literal shell metacharacters to a valid script
- **THEN** help lists supported developer scripts without offering publication lifecycle operations, an unknown script fails without launching a child, and literal arguments are forwarded as data
- **AND** a launched script's exit status or termination signal is reflected by the dispatcher

### Requirement: Authentication and configuration compatibility

The CLI SHALL preserve `login`, `logout` and `whoami`, the `reader-cli` configuration namespace, existing API-key and API-base persistence, the default API base, and the `X-API-Key` authentication contract. Migrating source repositories SHALL NOT require users to reauthenticate or move existing configuration. Authentication errors SHALL retain command failure status and machine-readable error envelopes; normal output SHALL NOT disclose a full valid API key.

#### Scenario: Use existing credentials after migration

- **WHEN** the migrated CLI runs `whoami --json` with an existing valid CLI configuration
- **THEN** it uses the stored API base and API key to request the current user without requiring login again
- **AND** its output retains the upstream user/account fields and redacted key prefix

#### Scenario: Login and logout through an isolated endpoint

- **WHEN** a user logs in with a synthetic valid-format API key and a custom API base, then runs `whoami` and `logout`
- **THEN** login verifies the key against the current-user endpoint, subsequent authenticated requests target that base, and logout removes the stored key
- **AND** a later authenticated command fails with the existing not-logged-in error rather than sending an unauthenticated account request

#### Scenario: Reject invalid credentials

- **WHEN** login receives missing or invalid input or the server rejects the supplied key
- **THEN** the CLI reports the established failure category and exits unsuccessfully
- **AND** a server-rejected key does not remain authenticated in local configuration

### Requirement: Bookmark command compatibility

The CLI SHALL preserve `add`, `list` and its `ls` alias, `get`, `archive`, `unarchive`, `star`, `unstar`, `delete` and `restore`, including their existing options, defaults, endpoint methods and request shapes. Human-readable output and successful `--json` envelopes SHALL retain existing data fields, including origin/snapshot links. The migration SHALL NOT conflate save-time `add --archive` with moving an existing bookmark to archive.

#### Scenario: Save and list a bookmark

- **WHEN** a user adds a URL with title, description, comma-separated tags and save-time archive mode, then lists with pagination and a filter
- **THEN** the CLI sends the established URL-add payload and list query, preserving URL normalization and tag parsing
- **AND** `list` and `ls` produce equivalent results with the established identifiers, origin links and snapshot links

#### Scenario: Read content and distinguish expected absence from failure

- **WHEN** a user gets a bookmark normally or with `--markdown`
- **THEN** the CLI requests metadata and content using the existing wire contract and negotiates Markdown when requested
- **AND** a content-not-generated 404 retains metadata with absent content, while other content request failures remain command failures

#### Scenario: Organize and recover a bookmark

- **WHEN** a user archives, unarchives, stars, unstars, deletes or restores an existing bookmark identifier
- **THEN** the CLI sends the existing status transitions to the existing endpoints
- **AND** delete/restore resolve the numeric bookmark identifier from metadata before submitting the trash operation
- **AND** a missing numeric identifier fails without sending an invalid trash request

#### Scenario: Preserve machine-readable failures

- **WHEN** bookmark input validation, API authentication/authorization, another API response, or a network request fails under `--json`
- **THEN** stdout contains the established failure envelope with `ok: false`, an error code and message, and an optional recovery hint
- **AND** the command exits unsuccessfully without mixing human progress text into its JSON output

### Requirement: Public agent skill lifecycle follows the migrated source

CLI install, skill synchronization, upgrade-driven skill synchronization and manual recovery instructions SHALL identify the monorepo's public `slax-reader` skill and SHALL NOT select repository development skills. The installed CLI package identity, skill-version stamps, update checks and `_hints` envelopes SHALL remain compatible with the source client. A failed skill installation SHALL NOT be recorded as successfully synchronized.

#### Scenario: Install or sync the public skill

- **WHEN** a user runs install, forces skill sync, or upgrades into a version requiring skill sync
- **THEN** the invoked installer targets the documented monorepo branch and public skill subdirectory and selects only `slax-reader`
- **AND** a successful synchronization records the installed CLI version using the existing state convention

#### Scenario: Explain incomplete skill synchronization

- **WHEN** the external skill installer fails
- **THEN** install or sync retains its existing partial-success or failure contract and provides a usable repair instruction
- **AND** no successful version stamp is written for that failed operation

#### Scenario: Retain version and skill hints

- **WHEN** a newer CLI version or out-of-sync skill is detected under the existing notifier rules
- **THEN** the CLI retains `_hints.upgrade` or `_hints.skill` and the existing upgrade repair workflow
- **AND** commands remain usable when best-effort update detection is unavailable

### Requirement: Reproducible and isolated migration verification

The repository SHALL provide automated CLI validation that checks the built executable against controlled HTTP endpoints and checks the packed package outside the workspace. CLI validation SHALL NOT require real account credentials, production bookmark mutations, global CLI installation or developer-agent skill installation. Pull-request CI SHALL run frozen installation, CLI typecheck/build/tests and package-consumer validation when CLI integration or its dependency declarations change. The CLI workflows SHALL NOT repeat full validation on post-merge branch pushes. Release workflows SHALL explicitly build the CLI and retain release guards and exact-archive consumer smoke validation instead.

#### Scenario: Exercise account and bookmark requests in CI

- **WHEN** CLI validation runs in an empty temporary user/config environment with synthetic credentials
- **THEN** it exercises real CLI processes against local HTTP fixtures and checks methods, request data, output and failure status
- **AND** registry/package-manager behavior is controlled so install/upgrade/skill coverage does not change global tools or agent state

#### Scenario: Avoid duplicate post-merge validation

- **WHEN** a reviewed change is merged into a long-lived branch
- **THEN** the CLI workflows do not rerun the full PR validation suites
- **AND** the release workflow runs the source/version guards, an explicit build and an installation smoke check of the final archive before publication

#### Scenario: Verify distribution before declaring migration complete

- **WHEN** the migration's acceptance checks are run
- **THEN** a freshly packed installation passes executable help/version checks and an authenticated local-fixture interaction from outside the workspace
- **AND** build-only or import-only checks do not substitute for those executable checks
