# Spec Delta

## MODIFIED Requirements

### Requirement: Root preflight reports frontend setup

The repository SHALL provide a root `preflight` script, invoked as `pnpm preflight`, backed by a script under `tooling/`, that checks the shared Node.js/pnpm runtime, workspace installation, and the selected API, Web, and Extension modules without starting or modifying local services. The default selection SHALL include all three modules, while `--app web`, `--app extension`, and `--app api` SHALL narrow the report.

#### Scenario: Dependencies are not installed

- **WHEN** a contributor runs `pnpm preflight` before installing the workspace
- **THEN** the command reports the missing pnpm installation marker or workspace links for each affected module
- **AND** it suggests running `pnpm install --frozen-lockfile`
- **AND** it exits with a non-zero status

#### Scenario: Required frontend variables are missing

- **WHEN** a required Web or Extension variable is absent for the selected environment
- **THEN** the command lists the missing variable name and affected app
- **AND** it never prints the variable value
- **AND** it exits with a non-zero status

#### Scenario: No app environment is configured

- **WHEN** none of the selected frontend app's required variables is present in its environment files or the process environment
- **THEN** the command tells the contributor which `deploy/local/.env.web` or `deploy/local/.env.extension` file to create
- **AND** it points to the matching `deploy/local/.env.<app>.example` for variable names and placeholder values

#### Scenario: Node.js or pnpm is unsupported

- **WHEN** the installed Node.js or pnpm version does not satisfy the repository's declared engine or package-manager pin
- **THEN** the command reports the detected and required versions
- **AND** it exits with a non-zero status

#### Scenario: API setup prerequisites are available but local services are absent

- **WHEN** API configuration, Docker, and Compose are available but PostgreSQL or PowerSync is not healthy
- **THEN** the API section says that API can start but cannot operate normally
- **AND** it suggests `pnpm api -- setup`
- **AND** it exits with a non-zero status


### Requirement: Preflight explains required configuration

The preflight report SHALL label shared URLs, cookie settings, app-specific API URLs, and Web's Google OAuth client ID as `（必填）`. Web's Apple OAuth client ID and Turnstile site key SHALL be labeled `（可选）`. Every startup or functionality failure SHALL include a safe next action or command, and system-tool remediation SHALL link to the official installation documentation where applicable. Labels and actions SHALL remain visible without color.

#### Scenario: Required value is missing or invalid

- **WHEN** a required Web or Extension variable is absent, empty, or malformed for the selected environment
- **THEN** its message includes the variable name and `（必填）`
- **AND** it points to the matching `deploy/local/.env.<app>.example` and local file to create
- **AND** it reports its startup or functionality impact without printing its value

#### Scenario: Google OAuth configuration is absent or empty

- **WHEN** `GOOGLE_OAUTH_CLIENT_ID` is absent or empty
- **THEN** its message includes `（必填）`
- **AND** it reports its startup or functionality impact without printing its value

#### Scenario: Optional Web service configuration is absent or empty

- **WHEN** `APPLE_OAUTH_CLIENT_ID` or `TURNSTILE_SITE_KEY` is absent or empty
- **THEN** it includes `（可选）`
- **AND** it is informational and does not block local frontend checks

### Requirement: Preflight follows the existing environment boundary

The preflight check SHALL inspect `deploy/local/.env.web`, `deploy/local/.env.extension`, their selected profile files, and API's selected `SLAX_API_CONFIG`/`deploy/local` files in the same order as the corresponding dispatchers and setup command. Process environment values SHALL take precedence. A root `.env` SHALL be reported as a reminder because application loaders do not automatically read it. Preflight SHALL not rewrite any environment or generated file.

#### Scenario: Contributor narrows a check

- **WHEN** a contributor passes `--app web`, `--app extension`, `--app api`, or `--env <profile>`
- **THEN** the command checks only the selected module or profile
- **AND** it does not inspect or modify unrelated module configuration

### Requirement: Preflight output distinguishes check states

The preflight command SHALL group its report into readable runtime, dependency, configuration, and service sections; distinguish successful, warning, blocking, and informational states; print a module status line before module details; and omit terminal control sequences when color is disabled or output is non-interactive.

#### Scenario: Contributor runs the check in an interactive terminal

- **WHEN** a contributor runs `pnpm preflight` in a terminal that supports color
- **THEN** section headings, module status, and check states use distinct visual styling
- **AND** the report keeps API, Web, and Extension checks visually separate

#### Scenario: Contributor redirects or disables colored output

- **WHEN** a contributor runs `pnpm preflight --no-color` or redirects output to a non-interactive stream
- **THEN** the report remains readable as plain text
- **AND** it contains no ANSI escape sequences

## ADDED Requirements

### Requirement: Preflight validates API local prerequisites safely

The API section SHALL check the selected API configuration path, required development variables and local Worker settings, API workspace dependencies, Docker executable, Compose plugin, Docker daemon, and the health/state of the PostgreSQL and PowerSync services defined by the repository. It SHALL use the same configuration selection rules as API setup, SHALL never print secret values, and SHALL distinguish a missing prerequisite from a service that has not yet been initialized.

#### Scenario: API startup configuration is missing or invalid

- **WHEN** the selected `api.toml` is missing, unreadable, or rejected by the API dev configuration validator
- **THEN** the report begins the API section with `API 当前无法启动`
- **AND** it names the missing file or invalid configuration category without exposing values
- **AND** it explains how to prepare the files, including `pnpm api -- config:init` only for the public template and the documented `.dev.vars` location
- **AND** it exits with a non-zero status

#### Scenario: Docker is missing or unavailable

- **WHEN** API startup prerequisites pass but Docker, Docker Compose, or a running Docker daemon cannot be used
- **THEN** the report begins the API section with `API 可启动，但无法正常运行`
- **AND** it gives an official Docker installation link and a command such as `docker info` or `docker compose version` to verify the fix
- **AND** it exits with a non-zero status

#### Scenario: Runtime secrets are absent or invalid

- **WHEN** API startup prerequisites pass but `.dev.vars`, a required runtime secret, or a valid PowerSync signing JWK is absent or invalid
- **THEN** the report says `API 可启动，但无法正常运行`
- **AND** it identifies authentication or synchronization as affected without printing secret values
- **AND** it exits with a non-zero status

#### Scenario: Docker and startup configuration both fail

- **WHEN** Docker is unavailable and the selected API configuration is invalid
- **THEN** configuration validation still runs and the API status is `API 当前无法启动`
- **AND** both startup and functionality findings are displayed

#### Scenario: API services are stopped or unhealthy

- **WHEN** configuration and Docker prerequisites pass but the local PostgreSQL or PowerSync containers are stopped, missing, or unhealthy
- **THEN** the report says `API 可启动，但无法正常运行`
- **AND** it suggests `pnpm api -- setup` and identifies the relevant service status
- **AND** it exits with a non-zero status

#### Scenario: API is ready

- **WHEN** API configuration, dependencies, Docker, PostgreSQL, PowerSync, and generated local runtime state pass their checks
- **THEN** the report says `API 启动检查通过`
- **AND** it does not run login, migrations, code generation, container startup, or Workers

### Requirement: Preflight validates complete Web readiness

The Web section SHALL check selected environment/profile values, workspace links, the Nuxt command, generated `.nuxt` preparation state, and local API binding inputs used by Web development. It SHALL distinguish a missing prerequisite from a valid Web checkout whose one-time setup has not run, and SHALL report API integration readiness separately from Web's own start readiness.

#### Scenario: Web startup prerequisites are missing

- **WHEN** a workspace link or Nuxt command is missing, or an environment file or API binding input cannot be parsed/validated
- **THEN** the report begins the Web section with `Web 当前无法启动`
- **AND** it names the missing category and points to `deploy/local/.env.web.example`, `pnpm install --frozen-lockfile`, or the relevant configuration command
- **AND** it exits with a non-zero status

#### Scenario: Web preparation is missing

- **WHEN** Web configuration and dependencies are valid but `.nuxt/tsconfig.server.json` is absent
- **THEN** the report says `Web 当前无法启动`
- **AND** it suggests `pnpm web -- setup` or the relevant API configuration action
- **AND** it exits with a non-zero status

#### Scenario: Web feature configuration is missing

- **WHEN** Web startup prerequisites pass but Google OAuth, cookie settings, or a required frontend URL is missing or malformed
- **THEN** the report says `Web 可启动，但无法正常运行` and identifies the affected feature
- **AND** it exits with a non-zero status

#### Scenario: Web is ready

- **WHEN** Web configuration, dependencies, Nuxt preparation, and local binding inputs pass
- **THEN** the report says `Web 启动检查通过`
- **AND** it may separately report that API integration still needs a running backend without claiming the integration is verified

### Requirement: Preflight validates complete Extension readiness

The Extension section SHALL check selected environment/profile values, workspace links, the WXT command, generated `.wxt` preparation state, and the syntax of configured Web/API origins. It SHALL distinguish a missing prerequisite from a valid Extension checkout whose one-time setup has not run, and SHALL report Web/API peer readiness separately from the Extension's own build readiness.

#### Scenario: Extension configuration or dependencies are missing

- **WHEN** a workspace link, WXT command, or PUBLIC_BASE_URL is absent or invalid, or an environment file cannot be parsed
- **THEN** the report begins the Extension section with `Extension 当前无法启动`
- **AND** it names the missing category and points to `deploy/local/.env.extension.example` or `pnpm install --frozen-lockfile`
- **AND** it exits with a non-zero status

#### Scenario: Extension preparation is missing

- **WHEN** Extension configuration and dependencies are valid but `.wxt/tsconfig.json` is absent
- **THEN** the report says `Extension 当前无法启动`
- **AND** it suggests `pnpm extension -- setup`
- **AND** it exits with a non-zero status

#### Scenario: Extension feature configuration is missing

- **WHEN** Extension startup prerequisites pass but cookie settings, login/sharing URLs, or its API URL is missing or malformed
- **THEN** the report says `Extension 可启动，但无法正常运行` and identifies the affected feature
- **AND** it exits with a non-zero status

#### Scenario: Extension is ready

- **WHEN** Extension configuration, dependencies, WXT preparation, and configured origins pass
- **THEN** the report says `Extension 启动检查通过`
- **AND** it may separately report that Web/API integration still needs running peers without claiming the integration is verified

### Requirement: Readiness status reflects actual impact

Findings SHALL distinguish startup blockers from missing dependencies or configuration that permits startup but prevents normal functionality. Startup blockers SHALL take precedence in module headings. Functionality failures SHALL use warning styling and explicitly identify affected capabilities; ordinary reminders and optional disabled services SHALL not degrade module status. Both failure classes SHALL produce exit code 1, with separate counts in the footer. Passing checks SHALL report `启动检查通过` without claiming full integration is verified.

#### Scenario: Known peer failure affects integration

- **WHEN** all modules are checked and API has a startup or functionality failure
- **THEN** Web and Extension reports include a functionality warning for API integration
- **AND** a Web failure likewise affects Extension integration
- **AND** an application's own startup blockers retain precedence

#### Scenario: Optional services are disabled

- **WHEN** only optional Apple OAuth or Turnstile settings are empty and all required checks pass
- **THEN** their diagnostics are informational, module startup checks pass, and the command exits zero

#### Scenario: Required generated code and runtime data differ

- **WHEN** an imported Prisma/DI artifact is missing
- **THEN** API startup is blocked
- **WHEN** only local D1 data is uninitialized
- **THEN** API functionality is incomplete and the diagnostic recommends setup
