## Purpose

Provide a safe root command that explains whether a contributor can start frontend checks and which required configuration is missing.

## ADDED Requirements

### Requirement: Root preflight reports frontend setup

The repository SHALL provide a root `preflight` script, invoked as `pnpm preflight`, backed by a script under `tooling/`, that checks the frontend runtime, pnpm workspace installation, and required Web and Extension environment variables without starting or modifying the backend.

#### Scenario: Dependencies are not installed

- **WHEN** a contributor runs `pnpm preflight` before installing the workspace
- **THEN** the command reports that the pnpm installation marker or required workspace links are missing
- **AND** it suggests running `pnpm install`
- **AND** it exits with a non-zero status

#### Scenario: Required frontend variables are missing

- **WHEN** a required Web or Extension variable is absent for the selected `SLAX_ENV`
- **THEN** the command lists the missing variable name and affected app
- **AND** it never prints the variable value
- **AND** it exits with a non-zero status

#### Scenario: No app environment is configured

- **WHEN** none of the selected app's required variables is present in its environment files or the process environment
- **THEN** the command tells the contributor which app-local environment file to create
- **AND** it points to that app's `.env.example` for variable names and placeholder values

#### Scenario: Only backend integration is unavailable

- **WHEN** frontend dependencies and required frontend variables are configured but `SLAX_BACKEND_DIR` is absent
- **THEN** the command reports backend integration as informational
- **AND** it does not fail the frontend preflight

### Requirement: Preflight follows the existing environment boundary

The preflight check SHALL inspect `.env`, `.env.<SLAX_ENV>`, and `.env.<SLAX_ENV>.local` inside each selected app directory in the same order as the current loaders. Process environment values SHALL take precedence. A root `.env` SHALL be reported as a reminder because the current app loaders do not automatically read it.

#### Scenario: Contributor narrows a check

- **WHEN** a contributor passes `--app web`, `--app extension`, or `--env <profile>`
- **THEN** the preflight check checks only the selected app or profile
- **AND** it does not rewrite any environment file

### Requirement: Preflight output distinguishes check states

The preflight command SHALL group its report into readable sections, distinguish successful, warning, blocking, and informational states, and omit terminal control sequences when color is disabled or output is non-interactive.

#### Scenario: Contributor runs the check in an interactive terminal

- **WHEN** a contributor runs `pnpm preflight` in a terminal that supports color
- **THEN** section headings and check states use distinct visual styling
- **AND** the report keeps the app, dependency, and environment checks visually separate

#### Scenario: Contributor redirects or disables colored output

- **WHEN** a contributor runs `pnpm preflight --no-color` or redirects output to a non-interactive stream
- **THEN** the report remains readable as plain text
- **AND** it contains no ANSI escape sequences
