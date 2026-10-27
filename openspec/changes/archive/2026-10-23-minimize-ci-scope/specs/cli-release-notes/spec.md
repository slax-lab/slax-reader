# Spec Delta

## Purpose

Give CLI users an accurate description of the CLI changes in each stable or preview release without incorporating unrelated monorepo work into its release announcement.

## ADDED Requirements

### Requirement: CLI release notes include only CLI-relevant changes

Every newly created CLI GitHub Release SHALL have an explicitly generated description limited to CLI implementation, CLI-consumed shared contracts, CLI tooling, CLI workflow, and CLI documentation changes. Web-only, Extension-only, API-only, and Mobile-only changes MUST NOT appear merely because they occurred between repository tags. Promotion merge commits MUST NOT introduce repository-wide PR summaries into CLI notes. A mixed change SHALL be represented only for its CLI-relevant portion. The description SHALL identify the CLI version, channel, and source revision and SHALL NOT label an unfiltered repository comparison as a CLI-only changelog.

#### Scenario: CLI and other applications change between releases

- **WHEN** the comparison range contains CLI work and unrelated Web and Mobile commits
- **THEN** the CLI description includes the CLI work and excludes those unrelated commits

#### Scenario: A shared contract used by CLI changes

- **WHEN** a shared contract consumed by CLI changes within the release range
- **THEN** the description identifies that shared CLI input and its source without presenting unrelated application changes as CLI features

#### Scenario: A promotion carries a large monorepo PR

- **WHEN** an eligible beta or stable release comes from a promotion merge
- **THEN** the description is based on CLI-scoped changes rather than the promotion PR's repository-wide title or generated PR list

#### Scenario: Only the CLI version changes

- **WHEN** the release range contains only a CLI manifest version increase
- **THEN** the description states the version change without inventing user-facing features

### Requirement: Comparison baselines follow CLI release channels and ancestry

Release notes SHALL compare the candidate against the highest lower CLI base version whose tag belongs to the same channel and whose commit is an ancestor of the candidate. The current candidate tag SHALL NOT be its own baseline. For the first release in a preview channel, selection SHALL fall back to the highest lower ancestor stable CLI tag. If no applicable prior CLI tag exists, the description SHALL explicitly identify the release as the first release for its comparison scope and use available CLI history. Other product tags and tags outside the candidate's ancestry MUST NOT determine the baseline. Malformed source identity, incomplete history, or comparison failures MUST stop creation of a new Release rather than fall back to repository-wide generated notes.

#### Scenario: A previous same-channel release exists

- **WHEN** lower-version ancestor tags exist for the candidate's channel
- **THEN** the highest applicable base version is selected, independently of other channels' publication dates

#### Scenario: First preview release has a stable baseline

- **WHEN** a preview channel has no earlier applicable channel tag but has a lower ancestor stable CLI tag
- **THEN** that stable tag is the baseline and the description identifies the comparison explicitly

#### Scenario: The candidate tag already exists on retry

- **WHEN** the release is retried after creating its own tag
- **THEN** that tag is excluded from baseline candidates and the same prior scope is retained

#### Scenario: No previous CLI release exists

- **WHEN** complete history contains no applicable prior CLI tag
- **THEN** the description reports the first-release case and contains only CLI-relevant available history

#### Scenario: History or comparison is unavailable

- **WHEN** baseline discovery or diff generation fails
- **THEN** no new Release is created with empty, misleading, or repository-wide fallback notes

### Requirement: Notes preserve release identity and retry boundaries

Generated descriptions SHALL be deterministic for the selected source, baseline, and policy and SHALL be prepared and validated before publication writes. Transferred release metadata SHALL bind the description to that source and baseline. Retrying a partial release SHALL reuse matching prepared notes when creating a missing Release and SHALL NOT silently rewrite an existing Release description. Existing eligibility, derived versions, immutable tags, tested archive bytes, checksums, preview restrictions, stable npm publication, and distribution permissions SHALL retain their contracts.

#### Scenario: Missing Release is created after an npm-success retry

- **WHEN** npm publication already succeeded and the matching GitHub Release is missing
- **THEN** the Release is created with the prepared CLI-scoped description after artifact identity verification
- **AND** npm is not republished

#### Scenario: An existing Release is resumed

- **WHEN** a matching Release already exists and a release asset is missing
- **THEN** the retry reconciles assets without automatically changing the existing description

#### Scenario: Prepared description is tampered with

- **WHEN** transferred notes or their bound source/baseline identity do not match release metadata
- **THEN** distribution fails before its publication writes

### Requirement: Distribution documentation distinguishes package and source archives

CLI distribution documentation SHALL identify the versioned CLI package and checksum as the installable release outputs. It SHALL explain that GitHub's automatic source ZIP/TAR links represent the tagged repository. Narrowing release descriptions SHALL NOT imply that those automatic source archives have been limited to the CLI subtree.

#### Scenario: User chooses a CLI download

- **WHEN** a user follows the CLI release instructions
- **THEN** the instructions identify the CLI tgz and checksum and explain the repository scope of GitHub's automatic source archives
