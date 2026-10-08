# API Release Deployment Spec Delta

## Purpose

Define when the API may be released from the monorepo and how each release selects existing environments, validates its artifacts, migrates databases, and publishes Workers without racing shared resources.

## ADDED Requirements

### Requirement: Releases require a merged pull request

The API release pipeline SHALL execute only for a pull request that has merged into `dev`, `beta`, or `main` in this repository. The deployment entry point and any reusable deployment call MUST enforce that prerequisite before running release code or accessing deployment credentials. An open pull request, an unmerged closure, a direct push, or an arbitrary manual dispatch MUST NOT cause a release. Merged pull requests from forks SHALL be eligible under the same conditions.

#### Scenario: Pull request merges into a release branch
- **WHEN** a pull request has merged into one of the three release branches
- **THEN** the pipeline selects that target branch's release environment and may proceed after its remaining validation succeeds

#### Scenario: Pull request closes without merging
- **WHEN** a pull request closes without being merged
- **THEN** the deployment job is skipped without accessing deployment credentials or mutating remote resources

#### Scenario: An alternate caller tries to bypass the merge entry point
- **WHEN** a reusable caller supplies a deployment environment or source revision without a qualifying merged pull request event
- **THEN** the release is rejected before source execution or remote mutation

#### Scenario: A fork contribution has been merged
- **WHEN** a fork pull request has merged into a release branch
- **THEN** the release uses the trusted merged repository commit and that environment's credentials without executing the unmerged fork head

### Requirement: Existing environment and resource identities are preserved

The pipeline SHALL map `dev` to the legacy test installation, `beta` to the existing beta installation, and `main` to the existing production installation. Test SHALL use the legacy test Cloudflare account and databases. Beta and production SHALL retain their existing production-account resources, shared PostgreSQL/logs databases, and shared Browser Worker. Selected configuration MUST preserve existing Worker names, routes, resource IDs, and Durable Object migration history; the pipeline MUST NOT substitute a template, create replacement resources, or bootstrap an existing installation. Missing environment metadata or a configuration/account mismatch MUST fail before remote mutation.

#### Scenario: A change is merged into dev
- **WHEN** the target branch is `dev`
- **THEN** the release selects the test credentials and configuration, including the existing test Edge Worker identity, without starting local Workers or selecting a local environment implicitly

#### Scenario: A change is promoted to beta or main
- **WHEN** the target branch is `beta` or `main`
- **THEN** the release selects the beta or production Worker configuration respectively and retains the shared production database relationships

#### Scenario: Configuration prerequisites are incomplete
- **WHEN** required configuration, credentials, account identity, or remote target metadata is absent or inconsistent
- **THEN** the release fails with the missing or invalid prerequisite identified without exposing secret values or beginning remote operations

### Requirement: Release artifacts are pinned and attributable

Source SHALL be checked out at the qualifying pull request's resulting merged commit, including the resulting commit for squash or rebase merges. Operator configuration SHALL be checked out at an explicitly configured immutable commit. The target environment MUST be derived from the pull request base branch rather than the workflow's default-branch context. Configuration paths MUST remain inside the private configuration checkout. Public release output SHALL identify only the public pull request, logical environment, public source commit, and safe stage results. The private repository identity, configuration revision, and private file paths MUST NOT be published.

#### Scenario: A production promotion runs under the default branch context
- **WHEN** a merged pull request targets `main` while the workflow runs from the repository's default branch
- **THEN** the release builds the production promotion's resulting commit and selects the production environment

#### Scenario: A configuration selector is mutable or escapes its checkout
- **WHEN** an operator supplies a branch/tag instead of an immutable configuration commit, or a path outside the configuration checkout
- **THEN** the release fails before migrations or publication

### Requirement: Validation and migrations precede Worker publication

The release SHALL complete dependency installation, generation, lint, type checking, tests, and four-Worker bundling before opening temporary database access. It SHALL verify database connectivity, apply outstanding primary PostgreSQL and logs migrations, and apply remote D1 and fulltext migrations before publishing the Workers. Validation SHALL use generation-only database placeholders; migrations MUST receive the selected environment's real connection values. Every stage MUST stop subsequent release operations on failure. Production-database migrations performed by beta MUST be compatible with currently serving production code.

#### Scenario: A release completes normally
- **WHEN** validation and database connectivity checks succeed
- **THEN** all four database migration operations succeed before the existing Workers are published in dependency order

#### Scenario: Validation or connectivity fails
- **WHEN** build validation fails or a database is unreachable within the bounded readiness period
- **THEN** no database migration or Worker publication begins

#### Scenario: A migration fails
- **WHEN** any PostgreSQL, logs, D1, or fulltext migration fails
- **THEN** remaining migrations and Worker publication stop, and the workflow reports failure

#### Scenario: D1 migrations run during release
- **WHEN** the release applies D1 or fulltext migrations
- **THEN** the operation targets the selected remote database rather than the runner's local D1 state

### Requirement: Temporary database access is cleaned up

The pipeline SHALL bound Tunnel startup, validate temporary firewall rule creation, and track the exact rule and Tunnel process it owns. Cleanup MUST be attempted after success, failure, or cancellation, and MUST remove only access created by that run. Cleanup failures MUST be surfaced without hiding an earlier deployment failure. Credentials and private connection values MUST NOT appear in workflow output.

#### Scenario: Publication fails after access is opened
- **WHEN** a release fails after creating a firewall rule or starting its Tunnel
- **THEN** cleanup attempts to remove its firewall rule and stop its Tunnel even though publication failed

#### Scenario: A pre-existing firewall rule already allows the runner
- **WHEN** the runner uses an existing access rule instead of a rule created by this run
- **THEN** cleanup preserves the pre-existing rule

### Requirement: Shared resources are serialized and stale releases are skipped

All beta and production migration/publication operations SHALL share a mutual-exclusion scope covering their common databases and Browser Worker. Test SHALL use an independent scope. A new release MUST NOT cancel an already executing release. Under that scope, the pipeline SHALL recheck the target branch before the first remote mutation and skip a run whose source commit has been superseded on that branch. The pipeline MUST NOT claim that every queued intermediate release executes in order.

#### Scenario: Beta and production promotions overlap
- **WHEN** beta and production releases are eligible at the same time
- **THEN** their remote operations cannot execute concurrently

#### Scenario: An old run is retried after newer changes land
- **WHEN** the target branch no longer points to the retried run's merged commit
- **THEN** the run is reported as superseded and performs no remote mutations

#### Scenario: A failed current release is retried
- **WHEN** the same merged commit is still the target branch tip
- **THEN** rerunning its existing workflow may retry the same source with the explicitly configured immutable configuration revision under the same validation and locking rules, validating the selected configuration revision without publishing it

### Requirement: Real deployment configuration is private and credentials use Actions Secrets

All real deployment configuration and infrastructure metadata SHALL be obtained from an authenticated private configuration repository after the merged-PR gate. Public workflow source, examples, and tests MUST contain only generic configuration structure and synthetic values. Checkout locators SHALL be protected through GitHub Actions Secrets. Credentials SHALL be supplied exclusively through GitHub Actions Secrets with minimum necessary scope; they MUST NOT be stored in the configuration repository or ordinary Actions Variables. Private configuration MUST remain declarative and MUST NOT introduce executable deployment scripts. A public configuration repository, invalid selector, or missing prerequisite MUST fail before deployment access or mutation.

#### Scenario: A release resolves its environment
- **WHEN** a qualifying merged PR selects test, beta, or production
- **THEN** the job fetches that environment's configuration and infrastructure metadata privately and obtains required credentials from its Actions Secrets

#### Scenario: An operator selects a public configuration repository
- **WHEN** the configured repository is public or its private status cannot be verified
- **THEN** the release fails without fetching deployment configuration or beginning remote mutations

#### Scenario: Credentials are embedded in fetched configuration
- **WHEN** fetched configuration contains credential material or requests executable commands instead of declarative settings
- **THEN** the release rejects it with a safe validation result without displaying the offending content

#### Scenario: A public PR runs validation
- **WHEN** local or ordinary pull-request CI validates the deployment implementation
- **THEN** it uses generic templates and synthetic fixtures without obtaining private checkout selectors, fetching real configuration, or receiving deployment secrets

### Requirement: Public CI output excludes private deployment information

Public logs, step annotations, job outputs, summaries, caches, and artifacts MUST NOT contain private configuration contents, private repository metadata, deployment hosts, resource/account identifiers, connection values, credentials, or their derived representations. This requirement SHALL cover checkout, validation, migration, publication, error reporting, and cleanup. Tool output MUST be restricted to safe stage-level results rather than relying solely on automatic secret masking. Dependencies MAY be cached only when the cache excludes private checkout data and configuration-derived files; raw release logs and private/generated configuration MUST NOT be uploaded.

#### Scenario: Deployment tooling prints bindings or endpoints
- **WHEN** a child tool produces configuration values or resource identities on stdout or stderr
- **THEN** public output contains only approved stage results, with the raw tool output kept out of logs, annotations, and artifacts

#### Scenario: Checkout or migration fails with private details
- **WHEN** checkout, parsing, connectivity, migration, or cleanup fails with an exception containing private values
- **THEN** the release reports a generic stage/error category and exit status without publishing the private exception, command arguments, or response body

#### Scenario: A derived value is not an Actions Secret
- **WHEN** a private value is obtained or transformed from downloaded configuration
- **THEN** the value remains excluded from public output even though it is not an original Actions Secret

#### Scenario: CI persists cache or artifacts
- **WHEN** workflow outputs are persisted beyond the job
- **THEN** no private checkout, credential helper, generated runtime configuration, raw release log, or configuration-derived deployment output is included

### Requirement: Private release files are ephemeral

Private configuration checkout, temporary credential helpers, private/generated configuration, and captured tool output SHALL remain restricted to the release job's temporary storage and necessary process environment. They MUST NOT be committed, exported as cross-job outputs, or retained as CI artifacts. Cleanup SHALL attempt to remove these files after success, failure, or cancellation in addition to closing temporary network access. Credential injection SHALL be limited to the processes/stages requiring each credential, without creating downloaded or generated plaintext credential configuration files.

#### Scenario: A release job completes or fails
- **WHEN** a release attempt ends after obtaining private configuration
- **THEN** cleanup attempts to remove the private checkout, helper files, private generated files, and captured raw output without printing their contents

#### Scenario: A stage does not need deployment credentials
- **WHEN** installation, offline checks, or a child process does not require a particular release credential
- **THEN** that credential is not injected into that process

### Requirement: Verification does not mutate live environments

Implementation acceptance SHALL verify event eligibility, branch/environment selection, artifact pinning, readiness failures, migration stop behavior, cleanup, and private-data exclusion from public output/persistence using synthetic inputs and isolated command substitutes. Local and pull-request verification MUST NOT access real private configuration, live deployment credentials, business databases, Worker deployment, or remote migrations. Operator documentation SHALL distinguish this offline verification from the first live release and identify prerequisites required before enabling it.

#### Scenario: Pull request verification checks the deployment change
- **WHEN** the deployment-policy and workflow checks run locally or in pull-request CI
- **THEN** they exercise qualifying and rejected events plus failure handling without contacting the deployment services
