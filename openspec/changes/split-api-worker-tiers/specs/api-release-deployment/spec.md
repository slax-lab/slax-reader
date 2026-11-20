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
