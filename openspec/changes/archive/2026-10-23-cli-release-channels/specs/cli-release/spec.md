# Spec Delta

## Purpose

Defines automatic CLI distribution as changes move through dev, beta, and main, with explicit release eligibility, version identity, downloadable archives, stable npm publication, and resumable failure handling.

## ADDED Requirements

### Requirement: Branch merges select releases using the actual CLI version

The repository SHALL initiate CLI release evaluation after pushes to its protected `dev`, `beta`, and `main` branches. An event SHALL be eligible only when its complete before/after diff changes `apps/cli/**` and the stable SemVer in `apps/cli/package.json` increases relative to the destination branch before the push. The version SHALL be read dynamically from the resulting source revision, never fixed to an example version. Evaluation SHALL use the event revisions and SHALL NOT select a later branch tip. Invalid source identity, invalid manifest identity or versions, decreases, unavailable comparison revisions, and unsupported branch-creation/deletion or history-rewrite events MUST fail without publication.

#### Scenario: A CLI version increase reaches dev

- **WHEN** a merged change to `dev` includes a stable CLI manifest version higher than the pre-merge `dev` version
- **THEN** that resulting version and merged revision are selected for the dev release
- **AND** a manifest-only version increase qualifies as a CLI-directory change

#### Scenario: Promote the same base version to another release line

- **WHEN** a promotion into `beta` or `main` changes the CLI directory and introduces a version higher than that destination's previous version
- **THEN** the promoted base version is selected for that destination's release
- **AND** the source branch does not need a separate version increment solely for promotion

#### Scenario: Skip changes without a new CLI version

- **WHEN** a branch merge changes no CLI-directory files or retains the previous CLI version
- **THEN** evaluation reports a successful skip without creating a tag, building a release, uploading release assets, or publishing npm

#### Scenario: A promotion contains several intermediate version increases

- **WHEN** one eligible promotion includes multiple intermediate CLI versions
- **THEN** one release uses the manifest version at that promotion's resulting revision

#### Scenario: Reject untrusted or incomplete event data

- **WHEN** event/source/manifest validation fails, the comparison revisions are unavailable, the CLI version decreases, or the event creates, deletes, or rewrites the branch
- **THEN** release evaluation fails with an actionable reason and performs no distribution writes

### Requirement: Release channels derive tags and package versions

For a stable source version `V`, the repository SHALL derive tag `cli-vV-dev` and package version `V-dev` on `dev`, tag `cli-vV-beta` and package version `V-beta` on `beta`, and tag `cli-vV` and package version `V` on `main`. It SHALL preserve the committed source manifest at the stable base version. The npm package identity SHALL remain `@slax-lab/reader-cli` and the executable SHALL remain `reader-cli`. The archive's manifest and installed executable version MUST both match the derived release version.

#### Scenario: Package a development prerelease

- **WHEN** an eligible dev release is built for actual source version `V`
- **THEN** its tag is `cli-vV-dev`, its packed manifest version and installed `reader-cli --version` are `V-dev`, and the committed manifest retains `V`

#### Scenario: Package beta and stable releases

- **WHEN** an eligible beta or main release is built for source version `V`
- **THEN** beta uses `cli-vV-beta` with `V-beta` in the package and executable
- **AND** main uses `cli-vV` with `V` in the package and executable

#### Scenario: Restore the source manifest after preparation failure

- **WHEN** release preparation fails after applying a derived build version
- **THEN** the source manifest is restored and no unverified package is distributed

### Requirement: Tags identify the tested merged revision

Every automatically created release tag SHALL resolve to the eligible event's merged revision. The source revision MUST remain reachable from the corresponding channel branch. Build and exact-archive installation validation SHALL finish successfully before creating a new tag or distributing a package. Automated tag creation and distribution SHALL complete in the originating branch workflow without relying on a subsequent tag-push workflow. A manually pushed tag SHALL NOT independently authorize publication under this branch-driven workflow.

#### Scenario: Publish from the original revision after the branch advances

- **WHEN** a release runs after newer commits land on its channel branch and the eligible revision remains reachable
- **THEN** the tested archive and tag identify the original event revision
- **AND** the latest branch tip does not replace that revision

#### Scenario: Build or consumer validation fails

- **WHEN** the release build or isolated installation smoke test fails
- **THEN** no new release tag, GitHub Release assets, or npm publication is created

#### Scenario: A matching tag already exists

- **WHEN** the derived tag already resolves to the selected source commit
- **THEN** the original event may continue or resume distribution after validating its artifact identity

#### Scenario: The derived tag points to another commit

- **WHEN** an existing derived tag resolves to a different commit or changes during release processing
- **THEN** publication fails with the conflicting identities and the workflow does not move, delete, or recreate that tag

### Requirement: Preview archives are downloadable GitHub prereleases

Eligible dev and beta releases SHALL each have a non-draft GitHub Pre-Release associated with their derived tag in `slax-lab/slax-reader`. Each release SHALL contain the exact consumer-tested installable CLI archive, a SHA-256 checksum file, and generated release notes. Preview releases MUST NOT publish to npm or change GitHub's stable latest release. The workflow SHALL preserve the standard npm archive distribution format rather than claim a standalone native executable.

#### Scenario: Download a preview build

- **WHEN** an eligible dev or beta release completes
- **THEN** users can download its versioned `.tgz` and `SHA256SUMS` from the corresponding tag's GitHub Pre-Release
- **AND** the archive bytes match the validated build artifact

#### Scenario: Keep previews separate from npm and stable latest

- **WHEN** any dev or beta release is distributed or retried
- **THEN** it performs no npm registry publication or npm latest update
- **AND** it does not become GitHub's stable latest release

### Requirement: Main preserves trusted npm publication of exact archive bytes

Eligible main releases SHALL publish the validated stable archive as `@slax-lab/reader-cli` through existing npm Trusted Publishing with provenance and distribute the identical bytes with a SHA-256 checksum and generated notes through a non-draft stable GitHub Release. Stable release revisions MUST be reachable from `main`. Publication SHALL use the configured `cli-release.yml` workflow identity and workflow-scoped credentials rather than require a user-created long-lived npm or GitHub token. A new unpublished stable version MUST be newer than npm latest.

#### Scenario: Publish a new stable release after promotion

- **WHEN** an eligible main event passes archive validation and npm trusted-publisher authorization
- **THEN** npm receives the tested stable archive and its tag's GitHub Release receives the identical bytes and checksum
- **AND** embedded source identity matches the main event revision

#### Scenario: Reject a stale unpublished stable version

- **WHEN** an unpublished stable candidate is no newer than npm latest
- **THEN** publication fails without moving latest backward

#### Scenario: Reject a stable source outside main

- **WHEN** a stable candidate's source revision is not reachable from main
- **THEN** no npm or stable GitHub Release publication occurs

### Requirement: Release retries retain immutable identities and outputs

The repository SHALL support rerunning the original eligible event to resume a partial release. Existing tags, npm versions, Release state, and uploaded assets SHALL be reused only when their identity and bytes match the candidate. Missing Release outputs SHALL be created or uploaded; conflicting or duplicate assets SHALL fail without overwrite. npm authentication or network failures MUST NOT be interpreted as proof that a version is unpublished. Preview and stable release lines MUST NOT cancel one another merely because another line starts publishing.

#### Scenario: Resume a partially uploaded preview

- **WHEN** the preview tag and Release match the candidate but an attachment is missing
- **THEN** a retry retains matching assets and uploads only the missing attachment
- **AND** a conflicting attachment or incorrect prerelease state fails without replacement

#### Scenario: npm succeeds before GitHub fails

- **WHEN** the exact npm version already exists but its GitHub Release or attachments are missing
- **THEN** a retry verifies registry archive integrity, bytes, and source identity before skipping npm publication and completing only missing GitHub outputs
- **AND** the retry does not move npm or GitHub latest backward

#### Scenario: Distinguish registry failure from missing publication

- **WHEN** a registry query fails with authentication, rate limiting, server, or transport errors rather than a genuine not-found response
- **THEN** the stable release fails without assuming that version can be published

#### Scenario: Detect artifact tampering or source mismatch

- **WHEN** transferred archive checksums, embedded metadata, or candidate/event identity disagree
- **THEN** distribution fails before creating a tag, publishing npm, or uploading assets

#### Scenario: Release different channels concurrently

- **WHEN** dev, beta, and main release runs overlap
- **THEN** a run on one release line does not cancel a run on another line
- **AND** stable publication preserves its latest-version guards

### Requirement: Validation and rollout remain separate from real publication

Pull-request CI SHALL retain full CLI validation. Post-merge releases SHALL build and validate the exact archive without repeating the full PR suites. Local orchestration tests SHALL use controlled GitHub/npm fixtures and SHALL NOT create public tags, Releases, or npm publications. Adopting the workflow SHALL NOT retroactively release the existing manifest version or rewrite historical distribution state; the next qualifying version increase starts automatic distribution.

#### Scenario: Validate release automation locally

- **WHEN** local or PR tests exercise channel selection and publication recovery
- **THEN** they check observable outcomes against controlled fixtures without mutating public distribution systems

#### Scenario: Adopt automation without a CLI version increase

- **WHEN** the new workflow lands but the CLI manifest version remains unchanged
- **THEN** it performs no retroactive release
- **AND** the next qualifying version increase selects its actual version dynamically

#### Scenario: Maintain the PR and release validation boundary

- **WHEN** a reviewed version change reaches a long-lived branch
- **THEN** the release performs an explicit build and consumer verification of the final archive
- **AND** full CLI typecheck, unit/integration, and root tooling suites remain in PR CI rather than being repeated after merge
