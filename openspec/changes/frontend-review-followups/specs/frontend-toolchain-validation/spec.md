# Spec Delta

## Purpose

Ensure frontend contributors receive real type-check feedback, usable shared imports, reliable local command termination, and consistent installation policy without requiring production credentials.

## ADDED Requirements

### Requirement: Frontend CI checks application types

Frontend CI SHALL execute TypeScript checks for both applications using public placeholder configuration, and SHALL fail when either check reports errors.

#### Scenario: CI without production services
- **WHEN** frontend checks run with the workflow's placeholder URLs and OAuth client identifier
- **THEN** both applications complete their preparation and actual TypeScript checks without requiring a live backend or real credentials

### Requirement: Declared Axios subpath is usable

The shared frontend utilities package SHALL expose its existing Axios client, cancellation helper, and associated types through its declared axios subpath.

#### Scenario: Consumer imports the client
- **WHEN** a workspace consumer imports from @commons/frontend-utils/axios
- **THEN** the existing client and cancellation helper are available and a configured fake transport can complete a request

### Requirement: Repeated termination reaches the child

The Web Wrangler wrapper SHALL forward every SIGINT and SIGTERM it receives while its child is running, and SHALL preserve interrupted exit status without starting an SSR server after a cancelled build.

#### Scenario: Child requires a second termination request
- **WHEN** the child handles the first signal without exiting and the wrapper receives a second signal of the same kind
- **THEN** the child receives both signals and the wrapper exits after the child closes

### Requirement: Frontend dependencies preserve install-script restrictions

Workspace installation SHALL block protobufjs and sharp lifecycle scripts while supporting the frontend toolchain with standard published platform binaries.

#### Scenario: Clean supported-platform installation
- **WHEN** the locked workspace dependencies are installed from a fresh virtual store on a supported platform
- **THEN** neither blocked dependency's lifecycle script executes and frontend checks and builds remain usable
