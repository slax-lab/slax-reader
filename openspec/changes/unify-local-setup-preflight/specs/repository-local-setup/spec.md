# Spec Delta

## Purpose

Provide one predictable repository-root command for preparing the API, Web, and Extension after installation, while preserving each application's setup semantics and keeping application startup explicit.

## ADDED Requirements

### Requirement: Existing API setup command participates in root setup

The root workflow SHALL invoke the backend's existing `pnpm api -- setup` command for API initialization. That command SHALL validate operator-provided configuration, initialize local PostgreSQL and PowerSync dependencies, apply the documented local migrations, generate required code, wait for service health, and exit without starting API Workers.

#### Scenario: API setup completes

- **WHEN** a contributor runs `pnpm api -- setup` with valid local configuration and Docker available
- **THEN** local API dependencies, migrations, generated assets, and PowerSync health checks complete in the existing order
- **AND** the command exits with a success status
- **AND** API Workers remain stopped

#### Scenario: API setup is incomplete

- **WHEN** configuration validation, login, a migration, code generation, Docker startup, or a PowerSync health check fails
- **THEN** the command returns a non-zero status and identifies the failed phase
- **AND** it does not claim setup completion or start later application phases

### Requirement: Root setup:all orchestrates all local applications

The repository SHALL provide a root package script named `setup:all` that runs API setup, Web setup, and Extension setup exactly once, in that order, from the repository root. It SHALL forward each child exit status and stop before later modules when an earlier module fails. The documented invocation SHALL be `pnpm setup:all`.

#### Scenario: Fresh repository setup

- **WHEN** a contributor runs `pnpm setup:all` after `pnpm install --frozen-lockfile`
- **THEN** the root command runs `pnpm api -- setup`, `pnpm web -- setup`, and `pnpm extension -- setup` in order
- **AND** it exits successfully only after all three complete

#### Scenario: API setup fails

- **WHEN** `pnpm api -- setup` exits non-zero
- **THEN** root setup exits with a non-zero status
- **AND** Web and Extension setup are not started

#### Scenario: Frontend setup fails

- **WHEN** API setup succeeds but Web or Extension setup exits non-zero
- **THEN** root setup stops at the failed frontend module
- **AND** it identifies the failed module and preserves its exit status

### Requirement: Setup documentation defines repeatable lifecycle

The repository documentation SHALL state when contributors must run `pnpm preflight`, `pnpm setup:all`, `pnpm api -- setup`, and each application setup independently; SHALL explain that setup is safe to repeat after dependency or generated-cache removal; and SHALL distinguish setup from starting `pnpm api -- dev`, `pnpm web -- dev`, and `pnpm extension -- dev`.

#### Scenario: Generated frontend state is removed

- **WHEN** `.nuxt` or `.wxt` is removed after a successful install
- **THEN** the documentation directs the contributor to rerun the affected frontend setup or `pnpm setup:all` before starting development

#### Scenario: Setup is complete but services are not started

- **WHEN** the root setup command succeeds
- **THEN** the documentation tells the contributor to start API, Web, and Extension separately and does not imply that a running server or authenticated browser session exists
