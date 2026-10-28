# Spec Delta

## MODIFIED Requirements

### Requirement: Releases require a merged pull request

Deployment SHALL be expressed in one GitHub Actions workflow using inline steps and existing API commands, with no new maintained deployment orchestrator, manifest, release validation command or separate custom scanner framework. The API release pipeline SHALL execute only for a pull request that has merged into `dev`, `beta`, or `main` in this repository. The single deployment workflow MUST enforce that prerequisite before running release code or accessing deployment credentials. An open pull request, an unmerged closure, a direct push, or an arbitrary manual or reusable dispatch MUST NOT cause a release. Merged pull requests from forks SHALL be eligible under the same conditions.

The workflow SHALL select API-related changes through native path filters covering API source, contracts, API command/workflow/template files, the migration release evidence checker, and root package/lock/workspace manifests. A merge changing only Web, Extension, frontend-only shared packages or repository documentation MUST NOT initiate API deployment. Future Web deployment and Extension packaging SHALL use their own application and frontend-shared paths; this change SHALL document those scopes without adding placeholder release jobs.

#### Scenario: Pull request merges into a release branch
- **WHEN** a pull request with API-related changes has merged into one of the three release branches
- **THEN** the pipeline selects that target branch's release environment and may proceed after its remaining validation succeeds

#### Scenario: A frontend-only or repository documentation-only change merges
- **WHEN** a merged pull request changes only Web, Extension, frontend-only shared packages or repository documentation
- **THEN** no API release workflow is initiated

#### Scenario: A shared contract or root dependency manifest changes
- **WHEN** a merged pull request changes shared contracts or a root package, lock or workspace manifest
- **THEN** the API workflow is eligible because those paths affect the API as well

#### Scenario: The migration release evidence checker changes
- **WHEN** a merged pull request changes the migration release evidence checker
- **THEN** the API workflow is eligible because that file governs API release safety

#### Scenario: Pull request closes without merging
- **WHEN** a pull request closes without being merged
- **THEN** the deployment job is skipped without accessing deployment credentials or mutating remote resources

#### Scenario: An alternate deployment trigger is attempted
- **WHEN** a push, manual dispatch or reusable caller has no qualifying merged pull request event
- **THEN** the deployment workflow has no such entry point and performs no release

#### Scenario: A fork contribution has been merged
- **WHEN** a fork pull request has merged into a release branch
- **THEN** the release uses the trusted merged repository commit and that environment's credentials without executing the unmerged fork head

### Requirement: Validation and migrations precede Worker publication

The release SHALL complete dependency installation, configuration validation, generation and four-Worker bundling before opening temporary database access. Lint, type checking and tests SHALL remain in the existing PR CI rather than being repeated during release. After the superseded-release check and before the first remote mutation, the release MUST evaluate migration release evidence for the release diff: declaration completeness, release-diff immutability, the hotfix rule, and, for `beta` and `main`, the prerequisite and known-head deployment evidence a current `contract` requires. The check MUST be read-only and MUST NOT use database or deployment credentials. After bounded Tunnel listener startup, the existing migration commands SHALL connect to their databases, apply outstanding primary PostgreSQL and logs migrations, and apply remote D1 and fulltext migrations before publishing the Workers. Validation SHALL use generation-only database placeholders; migrations MUST receive the selected environment's real connection values. Every stage MUST stop subsequent release operations on failure. Production-database migrations performed by beta MUST be compatible with currently serving production code.

#### Scenario: A release completes normally
- **WHEN** validation, migration release evidence, Tunnel startup and database migration connections succeed
- **THEN** all four database migration operations succeed before the existing Workers are published in dependency order

#### Scenario: Validation or Tunnel startup fails
- **WHEN** build validation fails or the local Tunnel listener does not become available within 30 seconds
- **THEN** no database migration or Worker publication begins

#### Scenario: Migration release evidence fails before remote access
- **WHEN** the migration release evidence check rejects the release
- **THEN** no firewall rule is created, no Tunnel starts, no database is contacted, and no Worker is published

#### Scenario: A dev release carries a contract
- **WHEN** the target environment is `dev` and the release adds a contract
- **THEN** declaration and immutability checks run, prerequisite and deployment evidence are skipped because the database is test-only, and the test database may be migrated

#### Scenario: An expand-only release during a deployments outage
- **WHEN** the release diff adds no current contract and the deployments API is unavailable
- **THEN** the preflight does not call the deployments API and proceeds

#### Scenario: The release is superseded
- **WHEN** the target branch's API-related contents no longer match the release's merged commit
- **THEN** the run reports itself superseded and performs no migration evidence check, remote mutation, or publication

#### Scenario: A migration fails
- **WHEN** any PostgreSQL, logs, D1, or fulltext migration fails, including a database connection failure
- **THEN** remaining migrations and Worker publication stop, and the workflow reports failure

#### Scenario: The logs database is unavailable after the primary migration
- **WHEN** the primary migration succeeds but the subsequent logs migration cannot connect
- **THEN** the completed primary migration remains applied, later operations stop and cleanup runs, matching the legacy sequential release behavior

#### Scenario: D1 migrations run during release
- **WHEN** the release applies D1 or fulltext migrations
- **THEN** the operation targets the selected remote database rather than the runner's local D1 state
