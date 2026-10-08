# Proposal

## Why

The monorepo has a manual/reusable API deployment workflow, but it does not automatically release merged changes or perform the PostgreSQL, logs, and D1 migrations from the legacy backend workflow. Restore that release process with an explicit merged-PR prerequisite and confidentiality boundaries suitable for a fully open-source repository with public CI logs.

## What Changes

- Add an automatic API release entry point for merged pull requests targeting `dev`, `beta`, or `main`, including merged contributions from forks.
- Preserve the legacy mapping: `dev` replaces `develop` and uses test resources; `beta` keeps the beta Workers on the production account/database; `main` replaces `master` and deploys production.
- Pin source checkout to the pull request's merged commit and a private operator configuration repository to an immutable commit. Fetch all real deployment configuration and infrastructure metadata from that private repository; public workflows, documentation, and fixtures contain only generic names, schemas, and synthetic examples.
- Obtain credentials exclusively from GitHub Actions Secrets in the selected GitHub Environment. Store private configuration checkout locators in Actions Secrets as well; do not use ordinary Actions Variables for private deployment data or download credential files from the configuration repository.
- **BREAKING**: Remove arbitrary `workflow_dispatch` deployment and caller-selected configuration metadata. Reusable calls must also prove that the triggering pull request merged into the selected release branch. Retry failed releases through their existing workflow runs.
- Restore temporary firewall access, Cloudflare Tunnel connectivity, PostgreSQL/logs migrations, and D1/fulltext migrations before publishing the existing four Workers. Correct the legacy workflow's D1 `--local` commands to remote migrations.
- Serialize beta and production releases because they share PostgreSQL/logs and the Browser Worker; keep test releases independent. Skip superseded releases before remote mutations and always clean up temporary access.
- Prevent private checkout metadata, configuration contents, infrastructure identities, credentials, and derived values from entering public logs, summaries, outputs, caches, or uploaded artifacts, including during failure and cleanup. Keep private files temporary and public PR checks independent of private configuration access.
- Document operator configuration, legacy secret-name mappings, environment restrictions, retry behavior, confidentiality guarantees, and offline verification using placeholders only.

## Capabilities

### New Capabilities

- `api-release-deployment`: Merge-gated API deployment, private configuration and Actions Secrets, public-output confidentiality, legacy environment/resource selection, pinned artifacts, migration sequencing, shared-resource locking, and failure cleanup.

### Modified Capabilities

None. The existing `release-branching` requirements already define `dev`/`beta`/`main`, their environment meanings, and promotion through pull requests.

## Impact

- `.github/workflows/api-deploy.yml`, a new merge-entry workflow, and the API CI path/check configuration.
- Repository workflow-policy tooling and focused offline tests; deployment documentation under `docs/api/`.
- Operator-managed GitHub Environments (`dev`, `beta`, `prod`), a private declarative deployment manifest and native configurations, protected checkout selectors, Actions Secrets, and existing Cloudflare/database resources.
- Beta continues to migrate the production PostgreSQL/logs databases before production code is promoted; migrations must remain compatible with the currently deployed production code.

## Non-goals

- Changing application behavior, schema history, Worker identities, live resource IDs, or the release-branch protection/merge rules.
- Automatically creating cloud resources, uploading Worker runtime secrets, or using bootstrap during routine releases.
- Running a live deployment or remote migration while implementing or locally verifying this change.
