# Spec Delta

## Purpose

Provide a safe root command that explains whether a contributor can start frontend checks and which required configuration is missing.

## MODIFIED Requirements

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
- **THEN** the command tells the contributor which `deploy/local/.env.web` or `deploy/local/.env.extension` file to create
- **AND** it points to the matching `deploy/local/.env.<app>.example` for variable names and placeholder values

### Requirement: Preflight follows the existing environment boundary

The preflight check SHALL inspect `deploy/local` for the matching `.env.web` or `.env.extension` file and its selected profile file, in the same order as the root frontend dispatchers. Process environment values SHALL take precedence. A root `.env` SHALL be reported as a reminder because the current frontend loaders do not automatically read it.

#### Scenario: Contributor narrows a check

- **WHEN** a contributor passes `--app web`, `--app extension`, or `--env <profile>`
- **THEN** the preflight check checks only the selected app or profile
- **AND** it does not rewrite any environment file

