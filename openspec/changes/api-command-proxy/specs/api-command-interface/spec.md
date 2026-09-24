## Purpose

Provide an application-owned backend command surface with a single repository-root abstraction, while keeping API-specific configuration, schemas, migrations, and generated assets inside the API application boundary.

## ADDED Requirements

### Requirement: Concrete backend commands belong to the API application

The backend SHALL declare its concrete development, generation, validation, migration, deployment, diagnostic, and local acceptance commands in `apps/api/package.json`. The root manifest MUST NOT duplicate that concrete command catalog.

#### Scenario: API command catalog is discoverable
- **WHEN** a maintainer inspects the backend application manifest
- **THEN** the concrete command names and their application-specific command composition are defined there
- **AND** the command definitions can use API-local relative paths without requiring a second root copy

#### Scenario: Application-specific configuration stays local
- **WHEN** a configuration is only consumed by the API commands or API build assets
- **THEN** it is stored under `apps/api/`
- **AND** it is not promoted to the repository root solely to make the root abstraction work

### Requirement: Root exposes one abstract API command entry

The repository SHALL expose a root command with the form `pnpm api -- <command> [args...]` that dispatches to the API workspace command while preserving arguments, output, exit status, and signal behavior. Users MUST be able to invoke the backend from the repository root without changing directories.

#### Scenario: Root dispatches a concrete API command
- **WHEN** a maintainer runs `pnpm api -- test` from the repository root
- **THEN** the corresponding `apps/api` test command runs with remaining arguments forwarded unchanged
- **AND** the process exits with the same status as the application command

#### Scenario: Root dispatches an unknown command
- **WHEN** a maintainer runs `pnpm api -- does-not-exist`
- **THEN** the command fails with a clear unknown-command/usage error
- **AND** it does not execute a different command or silently fall back to a default

#### Scenario: Root command receives interrupt or termination
- **WHEN** the root abstraction starts an API command and receives an interrupt or termination signal
- **THEN** the child command receives the signal and the root process exits consistently with the child outcome

### Requirement: Reusable and application-specific files have explicit ownership

Repository-root files SHALL be limited to configuration or tooling genuinely reused by multiple workspaces or required to orchestrate the repository. API-only TypeScript configuration, Prisma configuration, API test configuration, API migrations, and API generated runtime configuration SHALL remain in `apps/api/`; deployment templates and shared local infrastructure MAY remain in root-owned `deploy/` directories.

#### Scenario: API-specific file placement
- **WHEN** a file is consumed only by API source, API tests, API generators, or API database operations
- **THEN** its authoritative copy is under `apps/api/`
- **AND** root commands reference it through the abstract API entry rather than copying it into root

#### Scenario: Shared file placement
- **WHEN** a file is consumed by multiple applications or implements repository-wide orchestration
- **THEN** it may remain at the repository root with ownership documented by the repository rules
- **AND** moving API commands back into `apps/api` does not duplicate shared deployment templates or local infrastructure

### Requirement: Root abstraction preserves safety and compatibility boundaries

The command ownership change SHALL preserve the current backend command behavior, including local-versus-remote distinctions, explicit remote authorization, secret isolation, generated output locations, and API business behavior. It MUST preserve API route paths, database models, historical migrations and business service logic; configured hosts and physical Worker/queue names MAY vary without changing logical binding roles.

#### Scenario: Remote operation remains explicit
- **WHEN** a maintainer dispatches a remote migration or deployment through the root abstraction
- **THEN** the original remote target and safety checks are preserved
- **AND** local validation commands do not provision or mutate remote resources

#### Scenario: Existing generated and runtime outputs remain stable
- **WHEN** generation, tests, and Worker builds are run through the new root abstraction
- **THEN** generated routes, dependency injection, Worker bundles, schema/client outputs, and migration paths retain their existing semantics
- **AND** any known pre-existing business test failure is reported rather than hidden or “fixed” by weakening validation

### Requirement: Single deployment configuration

The API SHALL provide one public `deploy/cloudflare/api.toml.example` and read ignored `api.toml` for development, builds, deployments and runtime type generation. Missing configuration MUST fail explicitly. Configuration SHALL use native Wrangler name/services/env fields. Worker identities SHALL follow native names/service bindings and existing backend naming conventions, with only Edge publicly exposed. Bindings and migrations SHALL come from the selected environment.

#### Scenario: Custom deployment
- **WHEN** an operator supplies their own Worker names, API origin and queue names
- **THEN** generated internal bindings and HTTP/queue dispatch use those configured identities
- **AND** resource IDs and migration history are preserved without rewriting operator configuration

#### Scenario: Offline validation
- **WHEN** an operator builds or generates types
- **THEN** no remote resources are deployed or provisioned
- **AND** type generation uses an isolated runtime-only configuration and an empty env file

#### Scenario: First deployment
- **WHEN** an operator explicitly requests bootstrap
- **THEN** the deployment orders initialization to resolve internal Worker dependency cycles and ends with all bindings installed
- **AND** normal deployment updates never silently enter bootstrap mode

#### Scenario: Unknown queue
- **WHEN** a queue event has no configured or legacy handler
- **THEN** processing fails so messages are not silently acknowledged

### Requirement: Operator-owned web origins
The API SHALL use the configured FRONT_END_URL for credentialed events CORS, image Referer checks and first-party share-link recognition, and SHALL use IMAGE_PREFIX for screenshot links. Existing deployment defaults SHALL remain compatible and matching SHALL use exact origins rather than host substrings.

#### Scenario: A custom frontend calls the API
- **WHEN** the caller uses the configured frontend origin
- **THEN** events preflight and error responses permit that exact credentialed origin and signed image requests pass the Referer check
- **AND** an attacker origin with that hostname as a prefix receives no credential allowance

#### Scenario: A custom frontend share is saved
- **WHEN** a URL points to `/s/<code>` on the configured frontend origin
- **THEN** it follows the existing share shortcut flow instead of generic webpage parsing

#### Scenario: Development runtime cannot be published accidentally
- **WHEN** remote deployment is requested with RUN_ENV other than prod
- **THEN** deployment fails before any cloud mutation, protecting development-only endpoints and production validation checks

### Requirement: Tool environment files load automatically
Prisma configurations and Cloudflare operational commands SHALL automatically load only deploy/local/.env using a fixed repository-relative path independent of cwd, without overwriting existing process variables. Missing files SHALL allow CI to provide process variables; unreadable files MUST fail without printing contents. Offline build, runtime type generation and resource/configuration plans MUST NOT load operator environment files.

#### Scenario: Prisma reads database URLs from a file
- **WHEN** database URLs are present only in deploy/local/.env
- **THEN** Prisma CLI reads them for PostgreSQL and logs configuration without a manual export
- **AND** setup-provided local database URLs retain precedence

#### Scenario: D1 uses file-based credentials
- **WHEN** a D1 operation is invoked through the API wrapper
- **THEN** its Wrangler process receives Cloudflare credentials loaded from deploy/local/.env
- **AND** database bindings and local state continue to come from api.toml and deploy/local respectively

#### Scenario: Environment files share one deployment directory
- **WHEN** operators prepare the default local configuration
- **THEN** api.toml, .env and .dev.vars all reside in deploy/local/
- **AND** root .env and legacy apps/api/.env are not loaded implicitly

#### Scenario: Runtime secrets stay separate
- **WHEN** local Workers start
- **THEN** deploy/local/.dev.vars is passed explicitly as their runtime variable file
- **AND** tool environment variables are not automatically included as Worker bindings

### Requirement: Setup and application startup are separate
The API SHALL offer setup to validate local prerequisites, run pnpm exec wrangler login once in apps/api, initialize infrastructure and historical migrations, generate clients and runtime assets, wait for PowerSync health, and exit without starting Workers. It SHALL preserve dev as a separate Worker-only command, expose setup as the single local-preparation command, remove the combined dev:full command, and stop on failure or interruption without starting later phases.

#### Scenario: Required development configuration is missing
- **WHEN** required runtime variables remain invalid in operator-provided files or the API PowerSync signing JWK is invalid
- **THEN** setup fails before starting infrastructure or applying migrations
- **AND** the error names the missing configuration without printing secret values

#### Scenario: Development environment is prepared
- **WHEN** setup runs with matching local database configuration, required files and Docker available
- **THEN** setup performs login before infrastructure preparation, returns without starting Workers, and child failures propagate
- **AND** no remote migrations or resource provisioning run automatically

### Requirement: Deployment tools share external configuration selection
All API deployment tools SHALL honor SLAX_API_CONFIG as a repository-relative or absolute path to the operator configuration. Explicit supported --config arguments SHALL take precedence. CI SHALL support a separate configuration repository without rewriting that repository or publishing its contents as artifacts.

#### Scenario: CI checks out a separate configuration repository
- **WHEN** CI supplies its selected TOML path through SLAX_API_CONFIG
- **THEN** generation, build, Wrangler/D1, resource tooling and deployment use that file consistently
- **AND** runtime type generation remains isolated from local secret discovery

#### Scenario: Initializing a local configuration with an external selection
- **WHEN** config:init is explicitly invoked while an external configuration is selected
- **THEN** it creates only the default local api.toml with exclusive-copy behavior
- **AND** the external configuration is never overwritten

### Requirement: Complete local API setup
The setup command SHALL validate operator-provided configuration and development keys, initialize databases, apply local migrations, generate code, wait for PowerSync service health, and exit without starting API Workers. It MUST NOT create, rewrite, migrate or back up operator configuration or generate keys. Missing or invalid configuration MUST stop startup with a specific error.

#### Scenario: Missing local configuration
- **WHEN** setup finds missing api.toml or required Worker variables
- **THEN** it lists the missing prerequisites and stops before infrastructure startup
- **AND** no configuration, backup or key files are created

#### Scenario: PowerSync startup fails
- **WHEN** a PowerSync container fails its health check or startup times out
- **THEN** setup returns nonzero and does not start Workers or claim completion

#### Scenario: Existing native Wrangler environments
- **WHEN** setup, dev or local D1 reads a file containing env.dev
- **THEN** it selects env.dev without rewriting the source or requiring custom workers tables
- **AND** vars and resource bindings do not inherit production values
- **AND** an existing valid development API domain is preserved; the local listener and local database checks remain in effect

#### Scenario: Explicit environment across tools
- **WHEN** the operator supplies --env or SLAX_API_ENV
- **THEN** build, runtime types, deployment, resource commands and D1 consistently select that environment
- **AND** an unknown environment fails without falling back to the top-level configuration

#### Scenario: Check without changes
- **WHEN** setup --check runs
- **THEN** it validates prerequisites without logging in, creating files or starting services


### Requirement: Local PowerSync shares the API signing identity
Local setup SHALL derive the PowerSync public verification parameters from POWERSYNC_JWK_PRIVATE_KEY in deploy/local/.dev.vars. It MUST validate the RSA signing key, pass only public n/e/kid parameters to the infrastructure process, and MUST NOT require, overwrite or generate duplicate key configuration files.

#### Scenario: Obsolete public-key files disagree or are absent
- **WHEN** the API signing key is valid but old dev-jwks files or compose.env are missing or contain a different key
- **THEN** setup continues using the public key derived from the API signing key
- **AND** Compose receives those public parameters, inherited stale parameters cannot override them, and all existing files remain unchanged

#### Scenario: Invalid signing key
- **WHEN** the API JWK is malformed, lacks required RSA fields, or cannot sign and verify RS256
- **THEN** setup fails before infrastructure changes and reports the specific category without revealing key values


#### Scenario: Authentication fails or is interrupted
- **WHEN** Wrangler login returns a nonzero exit code or setup receives a termination signal
- **THEN** setup propagates the failure or signal status, does not start infrastructure and never launches Workers

#### Scenario: Explicit application startup
- **WHEN** the operator runs dev after setup completes
- **THEN** it starts the configured Workers without repeating login, dependency setup or migrations
