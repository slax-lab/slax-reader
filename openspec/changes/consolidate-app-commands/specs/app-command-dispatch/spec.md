# Spec Delta

## Purpose

Provide predictable root entry points for frontend development while keeping each application's package scripts as the authoritative command list and execution environment.

## ADDED Requirements

### Requirement: Root dispatchers expose frontend app scripts

The repository SHALL provide root `web` and `extension` commands that invoke a script from the corresponding application workspace package using the form `pnpm web -- <command>` or `pnpm extension -- <command>`.

#### Scenario: Run a Web script

- **WHEN** a contributor runs `pnpm web -- dev` or `pnpm web -- build`
- **THEN** the dispatcher runs the matching script from `apps/web/package.json`
- **AND** arguments after the command are passed to that script

#### Scenario: Run an Extension script

- **WHEN** a contributor runs `pnpm extension -- dev` or `pnpm extension -- build`
- **THEN** the dispatcher runs the matching script from `apps/extension/package.json`
- **AND** arguments after the command are passed to that script

### Requirement: Dispatchers preserve command outcomes

The frontend dispatchers SHALL return the selected app script's exit status and SHALL report an unknown command without starting an app process.

#### Scenario: App script fails

- **WHEN** the selected app script exits with a non-zero status
- **THEN** the corresponding root dispatcher exits with the same non-zero status

#### Scenario: Command is unknown

- **WHEN** a contributor requests a command that is not present in the selected app's package scripts or dispatcher aliases
- **THEN** the dispatcher prints usage information and exits with a non-zero status
- **AND** it does not invoke pnpm for the app

### Requirement: Root scripts remain minimal

The root package SHALL expose the two frontend dispatchers without adding one root script per Web or Extension operation; app package scripts SHALL remain the source of truth for available operations.

#### Scenario: App scripts evolve

- **WHEN** an app package adds a user-facing script
- **THEN** the corresponding dispatcher can expose it without adding another root package script
