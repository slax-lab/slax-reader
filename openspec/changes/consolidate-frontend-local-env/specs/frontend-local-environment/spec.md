# Spec Delta

## Purpose

Centralizes the Web and Extension configuration that contributors need for local commands, alongside the API's own `deploy/local` files, while keeping secrets out of source control and making the root dispatchers and preflight checks agree on the same environment source.

## MODIFIED Requirements

### Requirement: Frontend deploy directories provide the canonical local configuration entry points

The repository SHALL provide a tracked `deploy/local/.env.web.example` documenting the variables accepted by Web, and a tracked `deploy/local/.env.extension.example` documenting the variables accepted by Extension. Real `.env.web`, `.env.web.*`, `.env.extension`, and `.env.extension.*` files SHALL remain ignored by Git. The same `deploy/local` directory SHALL also hold the API's own `.env` / `.env.dev` files and generated configuration; app-specific filenames SHALL prevent collisions between the three apps' configuration.

#### Scenario: A new Web contributor starts configuration

- **WHEN** a contributor follows the Web setup documentation
- **THEN** the documented copy step creates `deploy/local/.env.web` from `deploy/local/.env.web.example`
- **AND** the example identifies required values, optional values, and safe placeholder values without containing real secrets

#### Scenario: A new Extension contributor starts configuration

- **WHEN** a contributor follows the Extension setup documentation
- **THEN** the documented copy step creates `deploy/local/.env.extension` from `deploy/local/.env.extension.example`
- **AND** the example identifies the variables needed by the Extension without requiring backend deployment files

### Requirement: Root frontend commands load the matching deploy configuration

The Web dispatcher SHALL load configuration from `deploy/local/.env.web` and `deploy/local/.env.web.<profile>`, and the Extension dispatcher SHALL load configuration from `deploy/local/.env.extension` and `deploy/local/.env.extension.<profile>`, before starting the selected app command. The loader SHALL read the shared per-app file and the profile file for the selected `SLAX_ENV`; the default `development` profile SHALL use the requested `.env.<app>.dev` filename. A missing optional file SHALL not prevent a command from starting. Values from the profile file SHALL override the shared file, and values already present in the invoking process SHALL override both. The loaded values SHALL be passed only to the child command and SHALL not be printed or mutate the parent shell.

#### Scenario: Web development uses the local Web deploy files

- **WHEN** a contributor runs `pnpm web -- dev` with `deploy/local/.env.web` and `deploy/local/.env.web.dev`
- **THEN** the Nuxt development command receives the merged Web variables before it starts
- **AND** a value in `.env.web.dev` overrides the same value from `.env.web`
- **AND** a value exported in the invoking shell overrides both files

#### Scenario: Extension development uses the local Extension deploy files

- **WHEN** a contributor runs `pnpm extension -- dev` with `deploy/local/.env.extension` and `deploy/local/.env.extension.dev`
- **THEN** the WXT development command receives the merged Extension variables before it starts
- **AND** variables from `deploy/local/.env.web*` are not loaded into the Extension command

#### Scenario: A deploy file is absent

- **WHEN** a root frontend command has no profile file for the selected environment
- **THEN** the dispatcher continues with the shared file, process environment, and app defaults
- **AND** it does not create a file or expose a secret value in its output

#### Scenario: A deploy file is malformed

- **WHEN** a deploy environment file cannot be parsed
- **THEN** the dispatcher exits before starting the app command
- **AND** the error identifies the affected app and file path without printing any parsed value

### Requirement: Preflight validates the same configuration sources used by root commands

The frontend preflight command SHALL inspect `deploy/local` and process environment using the same per-app file names, precedence, and development alias as the root dispatchers. When no usable value is found, its guidance SHALL name the correct `deploy/local/.env.web` or `deploy/local/.env.extension` file and the matching `.env.<app>.example`. Required variables SHALL remain blocking, while optional provider variables SHALL be reported as optional and SHALL not block frontend checks.

#### Scenario: Web configuration is missing

- **WHEN** `pnpm preflight -- --app web` finds no usable Web variables
- **THEN** the output tells the contributor to create `deploy/local/.env.web` from `deploy/local/.env.web.example`
- **AND** missing required variables are marked as required and cause a non-zero result

#### Scenario: Optional providers are omitted

- **WHEN** `APPLE_OAUTH_CLIENT_ID` or `TURNSTILE_SITE_KEY` is empty in the Web deploy configuration
- **THEN** preflight labels the variable optional and does not fail solely because it is absent

### Requirement: Frontend documentation reflects the deploy layout

The Chinese and English frontend development guides SHALL use the `deploy/local/.env.<app>` paths for initial setup, explain the `.env.<app>` plus `.env.<app>.dev` development convention, and retain the warning that the root `.env` is not an automatic source. The documentation SHALL continue to distinguish public client configuration from server-only secrets.

#### Scenario: Contributor follows the documented development command

- **WHEN** a contributor reads the frontend development guide and runs the documented root command
- **THEN** the command and copy step reference the same `deploy/local` directory and app-specific filenames that preflight checks
- **AND** the guide does not instruct the contributor to place real secrets in tracked example files
