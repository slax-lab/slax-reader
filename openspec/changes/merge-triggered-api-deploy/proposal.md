# Proposal

## Why

The monorepo has a manual/reusable API deployment workflow, but it does not automatically release merged changes or perform the PostgreSQL, logs, and D1 migrations from the legacy backend workflow. Restore that release process with an explicit merged-PR prerequisite and confidentiality boundaries suitable for a fully open-source repository with public CI logs.

## What Changes

- Use one GitHub Actions workflow with inline steps and existing API commands; add no deployment orchestrator, manifest or new maintained validation scripts. Add an automatic API release entry point for merged pull requests targeting `dev`, `beta`, or `main`, including merged contributions from forks.
- Scope API releases to API source, contracts, API command/workflow/template files and root dependency manifests. Frontend-only and repository documentation-only merges do not publish the API. Reserve separate Web and Extension path scopes for their later release workflows.
- Preserve the legacy mapping: `dev` replaces `develop` and uses test resources; `beta` keeps the beta Workers on the production account/database; `main` replaces `master` and deploys production.
- Pin source checkout to the pull request's merged commit. Automatically resolve the private configuration repository's default branch to an immutable commit once per deployment attempt, without a manually maintained configuration-ref Secret. Fetch all real deployment configuration and infrastructure metadata at that resolved commit; public workflows, documentation, and fixtures contain only generic names, schemas, and synthetic examples.
- Select `api/dev.toml`, `api/beta.toml`, or `api/prod.toml` directly from the merged target; require no release manifest, configurable file selector, or duplicated Worker/account metadata. Keep the existing native file format and supply deployment account, firewall zone and Tunnel hostname through Actions Secrets; derive the local port from database Secrets.
- Obtain credentials exclusively from GitHub Actions Secrets in the selected GitHub Environment. Store private configuration checkout locators in Actions Secrets as well; do not use ordinary Actions Variables for private deployment data or download credential files from the configuration repository.
- **BREAKING**: Remove `workflow_dispatch` and `workflow_call` deployment entry points and caller-selected configuration metadata. Retry failed releases through their existing workflow runs.
- Restore temporary firewall access, Cloudflare Tunnel connectivity, PostgreSQL/logs migrations, and D1/fulltext migrations before publishing the existing four Workers. Correct the legacy workflow's D1 `--local` commands to remote migrations.
- Leave lint, type checking and tests in the existing PR CI. Release runs only configuration validation, generation and bundling, checks source currency once before remote mutation, and uses existing migrations to verify database connectivity after bounded Tunnel startup.
- Serialize beta and production releases because they share PostgreSQL/logs and the Browser Worker; keep test releases independent. Skip releases superseded by newer API-related changes before remote mutations; unrelated frontend/documentation commits do not invalidate an API release. Always clean up temporary access.
- Prevent private checkout metadata, configuration contents, infrastructure identities, credentials, and derived values from entering public logs, summaries, outputs, caches, or uploaded artifacts, including during failure and cleanup. Keep private files temporary and public PR checks independent of private configuration access.
- Document operator configuration, legacy secret-name mappings, environment restrictions, retry behavior, confidentiality guarantees, and offline verification using placeholders only.
- Document agent rules and a PR Secret-scan check for the independent configuration repository: forbid credential files and embedded credentials, inspect every PR commit, and keep findings out of logs and artifacts.

## Capabilities

### New Capabilities

- `api-release-deployment`: Merge-gated API deployment, private configuration and Actions Secrets, public-output confidentiality, legacy environment/resource selection, pinned artifacts, migration sequencing, shared-resource locking, and failure cleanup.

### Modified Capabilities

None. The existing `release-branching` requirements already define `dev`/`beta`/`main`, their environment meanings, and promotion through pull requests.

## Impact

- `.github/workflows/api-deploy.yml` and API generated-output directory selection.
- Existing API commands and inline workflow steps; deployment documentation under `docs/api/`.
- Operator-managed GitHub Environments (`dev`, `beta`, `prod`), three private native TOML configurations, protected checkout selectors, Actions Secrets, and existing Cloudflare/database resources.
- Beta continues to migrate the production PostgreSQL/logs databases before production code is promoted; migrations must remain compatible with the currently deployed production code.

## Non-goals

- Changing application behavior, schema history, Worker identities, live resource IDs, or the release-branch protection/merge rules.
- Automatically creating cloud resources, uploading Worker runtime secrets, or using bootstrap during routine releases.
- Running a live deployment or remote migration while implementing or locally verifying this change.
