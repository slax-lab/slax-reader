## Purpose

Define the repository behavior and layout for importing the Slax Reader DWeb and browser extension projects into the v2 monorepo while preserving the v2 skeleton and keeping the source repository untouched.

## ADDED Requirements

### Requirement: Frontend applications have stable locations

The repository SHALL place the migrated DWeb application under `apps/web` and the migrated browser extension under `apps/extension`. Application source, assets, tests, manifests, and application-specific build configuration SHALL remain below the corresponding application directory.

#### Scenario: A contributor opens the web application

- **WHEN** a contributor wants to change the DWeb application
- **THEN** the source and its local development instructions are discoverable under `apps/web`
- **AND** the contributor does not need to search unrelated root-level directories

#### Scenario: A contributor opens the extension

- **WHEN** a contributor wants to change the browser extension
- **THEN** the source, manifest, tests, and build instructions are discoverable under `apps/extension`
- **AND** extension-only configuration is not mixed into the Web application

### Requirement: Shared libraries are narrowly scoped

The repository SHALL place a library under `packages/` only when at least two applications use it. The frontend migration SHALL provide the three shared packages used by both applications: `types`, `frontend-utils`, and `selection`. The source's `types-pro` definitions SHALL be part of `types`; the source's `utils` library SHALL use the `frontend-utils` name so future Backend and CLI libraries can use their own scoped packages. The repository SHALL NOT introduce a catch-all shared package solely for convenience.

#### Scenario: Both applications use a shared library

- **WHEN** Web and Extension import a library from the migration source
- **THEN** that library is available from a dedicated package under `packages/`
- **AND** both applications resolve it through the pnpm workspace

#### Scenario: A library is app-specific

- **WHEN** a module is used by only one application
- **THEN** it remains inside that application
- **AND** it is not moved into `packages/` during this migration

### Requirement: The v2 root remains a stable skeleton

The migration SHALL keep application implementation code, app-specific configuration, and long-form app documentation out of the v2 root. Root changes SHALL be limited to workspace orchestration, repository governance, and navigation needed to use the migrated projects.

#### Scenario: A contributor reads the root

- **WHEN** a contributor opens the v2 root
- **THEN** they find repository-wide configuration and a concise navigation entry point
- **AND** they can follow links to Web, Extension, shared packages, and contribution documentation

### Requirement: The source repository is not modified

The migration SHALL treat the source `slax_reader` checkout as read-only. It SHALL NOT modify source files, branches, tags, remotes, issues, or documentation.

#### Scenario: Import is repeated

- **WHEN** the migration copies another source snapshot into v2
- **THEN** the source repository status and tracked content remain unchanged
- **AND** the imported source commit is recorded in v2 for traceability

### Requirement: The initial import preserves runtime behavior

The migration SHALL prioritize a runnable snapshot over refactoring. Web and Extension SHALL retain their existing backend integration and user-visible behavior during the initial import, subject only to path, package-name, and workspace adjustments required by the new layout.

#### Scenario: Web is validated after import

- **WHEN** the Web package is installed and its documented checks run
- **THEN** it can prepare, type-check, test, and build using the migrated workspace

#### Scenario: Extension is validated after import

- **WHEN** the Extension package is installed and its documented checks run
- **THEN** it can prepare, compile, test, build, and package using the migrated workspace

### Requirement: Migration provenance and onboarding are documented

The repository SHALL document the source repository, source snapshot, target mapping, backend boundary, safe environment-variable shape, and app-specific onboarding paths under `docs/`. The documentation SHALL not contain secret values.

#### Scenario: A third-party developer starts with one app

- **WHEN** a third-party developer wants to work only on Web or Extension
- **THEN** the root navigation leads to that app's README and its focused setup instructions
- **AND** the developer does not need to understand the backend migration to begin local work
