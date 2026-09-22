## Purpose

Provide a safe root command that explains whether a contributor can start frontend checks and which required configuration is missing.

## ADDED Requirements

### Requirement: Root doctor command reports frontend setup

The repository SHALL provide a root `doctor` script, invoked as `pnpm run doctor`, backed by a script under `tooling/`, that checks the frontend runtime, pnpm workspace installation, and required Web and Extension environment variables without starting or modifying the backend. Documentation SHALL explain that `pnpm doctor` is pnpm's separate built-in command.

#### Scenario: Dependencies are not installed

- **WHEN** a contributor runs `pnpm run doctor` before installing the workspace
- **THEN** the command reports that the pnpm installation marker or required workspace links are missing
- **AND** it suggests running `pnpm install`
- **AND** it exits with a non-zero status

#### Scenario: Required frontend variables are missing

- **WHEN** a required Web or Extension variable is absent for the selected `SLAX_ENV`
- **THEN** the command lists the missing variable name and affected app
- **AND** it never prints the variable value
- **AND** it exits with a non-zero status

#### Scenario: Only backend integration is unavailable

- **WHEN** frontend dependencies and required frontend variables are configured but `SLAX_BACKEND_DIR` is absent
- **THEN** the command reports backend integration as informational
- **AND** it does not fail the frontend setup check

### Requirement: Doctor follows the existing environment boundary

The doctor SHALL inspect `.env`, `.env.<SLAX_ENV>`, and `.env.<SLAX_ENV>.local` inside each selected app directory in the same order as the current loaders. Process environment values SHALL take precedence. A root `.env` SHALL be reported as a reminder because the current app loaders do not automatically read it.

#### Scenario: Contributor narrows a check

- **WHEN** a contributor passes `--app web`, `--app extension`, or `--env <profile>`
- **THEN** the doctor checks only the selected app or profile
- **AND** it does not rewrite any environment file
