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
- **THEN** the command tells the contributor which `deploy/local_web/.env` or `deploy/local_extension/.env` file to create
- **AND** it points to the matching deploy `.env.example` for variable names and placeholder values

### Requirement: Preflight explains required configuration

The preflight report SHALL label the shared URLs, cookie settings, app-specific API URLs, and Web's Google OAuth client ID as `（必填）`. Web's Apple OAuth client ID and Turnstile site key SHALL be labeled `（可选）`. Labels SHALL remain visible without color, and optional fields SHALL NOT be presented as universally required.

#### Scenario: Required value is missing or invalid

- **WHEN** a shared URL, cookie setting, or app API URL is absent, empty, or malformed
- **THEN** its message includes the variable name and `（必填）`
- **AND** it remains a blocking error without printing its value

#### Scenario: Google OAuth configuration is absent or empty

- **WHEN** `GOOGLE_OAUTH_CLIENT_ID` is absent or empty
- **THEN** its message includes `（必填）`
- **AND** it remains a blocking error without printing its value

#### Scenario: Optional Web service configuration is absent or empty

- **WHEN** `APPLE_OAUTH_CLIENT_ID` or `TURNSTILE_SITE_KEY` is absent or empty
- **THEN** its message includes `（可选）`
- **AND** it is informational and does not block local frontend checks

### Requirement: Preflight follows the existing environment boundary

The preflight check SHALL inspect the matching `deploy/local_web` or `deploy/local_extension` `.env` and selected profile files in the same order as the root frontend dispatchers. Process environment values SHALL take precedence. A root `.env` SHALL be reported as a reminder because the current frontend loaders do not automatically read it.

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
