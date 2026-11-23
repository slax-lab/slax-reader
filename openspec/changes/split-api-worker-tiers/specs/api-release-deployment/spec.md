## MODIFIED Requirements

### Requirement: Existing environment and resource identities are preserved

The pipeline SHALL map `dev` to the legacy test installation, `beta` to the existing beta installation, and `main` to the existing production installation. Test SHALL use the legacy test Cloudflare account and databases. Beta and production SHALL retain their existing production-account resources, shared PostgreSQL/logs databases, and shared Browser Worker. Selected configuration MUST preserve existing Worker names, routes, resource IDs, and Durable Object migration history, and SHALL add the Objects Worker as the only new Worker identity; no existing Durable Object namespace MAY be deleted, except the removed MCP server's `SlaxMcpServer` namespaces in the final transition step; the pipeline MUST NOT substitute a template, create replacement resources, or bootstrap an existing installation. Missing environment metadata or a configuration/account mismatch MUST fail before remote mutation.

#### Scenario: A change is merged into dev
- **WHEN** the target branch is `dev`
- **THEN** the release selects the test credentials and configuration, including the existing test Edge Worker identity, without starting local Workers or selecting a local environment implicitly

#### Scenario: A change is promoted to beta or main
- **WHEN** the target branch is `beta` or `main`
- **THEN** the release selects the beta or production Worker configuration respectively and retains the shared production database relationships

#### Scenario: Configuration prerequisites are incomplete
- **WHEN** required configuration, credentials, account identity, or remote target metadata is absent or inconsistent
- **THEN** the release fails with the missing or invalid prerequisite identified without exposing secret values or beginning remote operations

#### Scenario: Stateless Durable Objects move to the Objects Worker
- **WHEN** an existing installation runs the documented topology transition
- **THEN** the Objects Worker creates its classes, and every existing Durable Object namespace remains in place except the `SlaxMcpServer` namespaces, which only the final transition step deletes

### Requirement: Validation and migrations precede Worker publication

The release SHALL complete dependency installation, configuration validation, generation and five-Worker bundling (Edge, Core, AI, Objects and Browser) before opening temporary database access. Lint, type checking and tests SHALL remain in the existing PR CI rather than being repeated during release. After bounded Tunnel listener startup, the existing migration commands SHALL connect to their databases, apply outstanding primary PostgreSQL and logs migrations, and apply remote D1 and fulltext migrations before publishing the Workers. Validation SHALL use generation-only database placeholders; migrations MUST receive the selected environment's real connection values. Every stage MUST stop subsequent release operations on failure. Production-database migrations performed by beta MUST be compatible with currently serving production code.

#### Scenario: A release completes normally
- **WHEN** validation, Tunnel startup and database migration connections succeed
- **THEN** all four database migration operations succeed before the existing Workers are published in dependency order

#### Scenario: Validation or Tunnel startup fails
- **WHEN** build validation fails or the local Tunnel listener does not become available within 30 seconds
- **THEN** no database migration or Worker publication begins

#### Scenario: A migration fails
- **WHEN** any PostgreSQL, logs, D1, or fulltext migration fails, including a database connection failure
- **THEN** remaining migrations and Worker publication stop, and the workflow reports failure

#### Scenario: The logs database is unavailable after the primary migration
- **WHEN** the primary migration succeeds but the subsequent logs migration cannot connect
- **THEN** the completed primary migration remains applied, later operations stop and cleanup runs, matching the legacy sequential release behavior

#### Scenario: D1 migrations run during release
- **WHEN** the release applies D1 or fulltext migrations
- **THEN** the operation targets the selected remote database rather than the runner's local D1 state
