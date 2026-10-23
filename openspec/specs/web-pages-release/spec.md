# web-pages-release Specification

## Purpose
Publish reviewed Web changes to three existing Cloudflare Pages projects using environment-scoped GitHub configuration while preserving the projects' runtime bindings and account separation.

## Requirements

### Requirement: Merged Web changes select one release environment

The release workflow SHALL publish only merged pull requests targeting `dev`, `beta`, or `main` in this repository. It SHALL map those branches to GitHub Environments `dev`, `beta`, and `prod`, and Web build profiles `preview`, `beta`, and `production`, respectively. It SHALL build the pull request's merged revision, not the contributor's head revision. Web source, its shared package dependencies, release/build tooling, and root dependency manifests SHALL be included in the release path scope; API-only, Extension-only, and documentation-only changes SHALL NOT trigger Web publication.

#### Scenario: A Web pull request is merged into dev

- **WHEN** an eligible Web pull request is merged into `dev`
- **THEN** the release uses only the `dev` environment's configured destination and the `preview` Web build profile
- **AND** the checked-out source is its merged revision

#### Scenario: Beta and production use their own destinations

- **WHEN** an eligible Web pull request is merged into `beta` or `main`
- **THEN** it selects `beta` with the `beta` profile or `prod` with the `production` profile respectively
- **AND** no other environment is published

#### Scenario: An unmerged or unrelated change occurs

- **WHEN** a pull request is opened, updated, or closed without merging, or contains only changes outside the Web release path scope
- **THEN** it does not publish Web or receive release credentials

### Requirement: Operators provide environment-scoped inputs

Each release SHALL read `CLOUDFLARE_ACCOUNT_ID`, `PAGES_PROJECT_NAME`, and `WEB_BUILD_CONFIG` from the selected GitHub Environment's Variables and `CLOUDFLARE_API_TOKEN` from its Secrets. `WEB_BUILD_CONFIG` SHALL be a JSON object restricted to documented public Web configuration keys. Required values SHALL be validated before publication; unknown keys, malformed values, and missing inputs SHALL fail without fallback to a different destination or a successful no-op. Credential values SHALL NOT enter the client build configuration or deployment artifacts.

#### Scenario: The operator has not filled an environment

- **WHEN** a required input is absent
- **THEN** the release fails before publishing and identifies the input name without printing its value

#### Scenario: A build configuration attempts to inject server credentials

- **WHEN** the build JSON contains an unknown key, including deployment credentials or process-control settings
- **THEN** validation rejects the configuration before invoking the build

### Requirement: Publication targets the existing project's primary deployment

The release SHALL verify the specified Pages project exists under the configured account and obtain its current production branch before publication. It SHALL target that branch even when its name differs from the repository branch. It SHALL NOT create projects, change their production branches, or alter domains. Required `BACKEND` service and `OSS` storage bindings SHALL be checked without mutating them; missing prerequisites SHALL stop publication. The release helper SHALL NOT reject compatibility dates or flags before invoking Wrangler; Wrangler/Cloudflare SHALL remain responsible for interpreting those settings and reporting deployment errors.

#### Scenario: Repository main deploys to a legacy master branch

- **WHEN** repository `main` is released to a project whose production branch is `master`
- **THEN** the uploaded source comes from the merged `main` revision and the Pages deployment branch is `master`

#### Scenario: A project or required binding is unavailable

- **WHEN** the project lookup fails, its production branch is invalid, or required bindings are missing
- **THEN** publication stops with a bounded diagnostic and does not create a replacement project or infer a different account

#### Scenario: Compatibility settings are delegated to the deployment platform

- **WHEN** a project passes the project and binding checks but its compatibility settings are absent, old, or use different flags
- **THEN** the helper proceeds to Wrangler without changing or rejecting those settings
- **AND** any Wrangler or Cloudflare deployment failure still fails the release

### Requirement: Existing runtime configuration and application output are preserved

The release SHALL publish the existing Pages application output, including its server bundle, static assets, routing, headers, and redirects, without uploading a Wrangler configuration that takes ownership of the project's runtime settings. It SHALL preserve existing runtime variables, secrets, and bindings, including bindings not consumed by the release helper. It SHALL NOT perform API deployment, database migration, runtime-secret upload, or cloud-resource provisioning. Configuration files, dotenv files, credentials, and release metadata SHALL NOT be exposed as static assets.

#### Scenario: A project contains additional runtime bindings

- **WHEN** the target project has extra bindings such as a content database
- **THEN** the release leaves those bindings intact rather than replacing them with the build-time template's bindings

#### Scenario: Nuxt produces a generated Wrangler configuration

- **WHEN** the Web build emits deployment configuration beside its Pages output
- **THEN** the publication input excludes that configuration while retaining the compiled application and routing files
- **AND** deployment cannot discover a tracked, generated, or redirected repository Wrangler configuration

### Requirement: Releases are ordered and report real outcomes

Releases SHALL serialize per destination environment without cancelling an in-progress upload. Before publication, the workflow SHALL skip an older revision if a newer change in the same Web release path scope has reached that branch; unrelated changes SHALL NOT invalidate it. A build, upload, or final deployment failure SHALL fail the job. Rerunning a release SHALL retain its original source revision and repeat freshness and prerequisite checks.

#### Scenario: An older release is superseded

- **WHEN** a newer Web revision has reached the target branch before an older job begins publication
- **THEN** the older job reports a superseded skip and does not publish

#### Scenario: A deployment fails

- **WHEN** Pages rejects the upload or reports a failed final deployment
- **THEN** the job reports failure rather than claiming success from a successful upload request alone

### Requirement: Public automation keeps credentials and settings safe

Credential values and raw project responses SHALL NOT appear in public logs, summaries, outputs, caches, or uploaded artifacts. Temporary metadata and release files SHALL be cleaned up after success or failure. Pull-request validation SHALL use synthetic fixtures without production credentials. Operator documentation SHALL enumerate Variables and Secrets, distinguish public browser configuration from server secrets, and explain first-run verification and duplicate-build prevention without embedding live infrastructure identifiers.

#### Scenario: Inspection or publication returns an error

- **WHEN** an external request fails
- **THEN** the job reports a stage and safe status or error category without dumping request headers, response bodies, or secret-bearing process state

#### Scenario: A contributor runs the release tests

- **WHEN** release regressions run in pull-request CI
- **THEN** they exercise destination selection, failure handling, artifact preparation, and deployment argument construction without making a real deployment
