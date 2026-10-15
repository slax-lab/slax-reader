# Spec Delta

## Purpose

Distribute installable browser-extension archives from reviewed extension version increases on the repository's dev, beta and production branches, with consistent channel identity and recoverable GitHub publication.

## ADDED Requirements

### Requirement: Only merged extension version increases start release builds

The release system SHALL build only for a merged pull request in slax-lab/slax-reader targeting dev, beta or main when the complete destination-branch comparison changes apps/extension and increases its stable package version. A package-version-only change SHALL qualify. Unrelated changes and unchanged versions SHALL skip successfully. Automatic version increments MUST NOT occur.

#### Scenario: Extension version increases on dev
- **WHEN** a merged PR changes apps/extension/package.json from 1.16.2 to 1.16.3 on dev
- **THEN** one release build is eligible for the merged revision and version 1.16.3

#### Scenario: Extension changes without a version increase
- **WHEN** a PR changes extension code but keeps its package version unchanged
- **THEN** the release workflow reports a skip and performs no packaging or publication

#### Scenario: Unrelated merge
- **WHEN** a merged PR changes only Web, API, CLI or unrelated documentation
- **THEN** no extension release build starts

#### Scenario: Promotion introduces a newer destination version
- **WHEN** a promotion carries an extension version newer than beta or main had before the merge
- **THEN** the resulting version is eligible on that destination without another version edit

#### Scenario: No merged PR or invalid source
- **WHEN** an event is unmerged, from another repository or branch, forced, missing comparison history, or contains a decreased or invalid version
- **THEN** the system performs no release build or publication and reports the skip or validation failure

### Requirement: Channel identity remains installable and environment-specific

The system SHALL derive dev, beta and stable tags as ext-vV-dev, ext-vV-beta and ext-vV from the actual stable source version V. Dev and beta SHALL be GitHub prereleases and main SHALL be a stable Release. The packaged Chrome manifest SHALL retain the numeric base version and use version_name for channel display. Existing profile-specific extension IDs SHALL remain unchanged.

#### Scenario: Three channels from the same base version
- **WHEN** version 1.16.3 is promoted through dev, beta and main
- **THEN** the corresponding Releases use ext-v1.16.3-dev, ext-v1.16.3-beta and ext-v1.16.3, and all packages retain manifest version 1.16.3

#### Scenario: Channel-specific configuration
- **WHEN** a release is built for dev, beta or main
- **THEN** it uses the existing preview, beta or production profile respectively and retains that profile's extension ID

#### Scenario: Stable display version fallback
- **WHEN** WXT omits a stable version_name that equals the numeric version
- **THEN** the main archive is accepted with the numeric version providing the stable display, while dev/beta still require their exact suffixed version_name

### Requirement: Release configuration is explicit and public

Builds SHALL use validated public configuration for their target environment and MUST fail before publication when required configuration is missing or malformed. Publication credentials MUST NOT enter extension bundles or downloadable assets. Local secret files SHALL NOT be required.

#### Scenario: Missing environment configuration
- **WHEN** an eligible release lacks required Web, API or cookie configuration
- **THEN** packaging fails with an actionable configuration error and creates no tag or Release

#### Scenario: Reuse the destination Web configuration
- **WHEN** no extension-specific configuration is set and the destination Environment provides valid WEB_BUILD_CONFIG
- **THEN** the build reuses the shared URL/cookie fields, maps DWEB_API_BASE_URL to EXTENSIONS_API_BASE_URL, and excludes Web-only fields from the extension subprocess

#### Scenario: Explicit extension configuration takes precedence
- **WHEN** a nonempty EXTENSION_BUILD_CONFIG is set alongside WEB_BUILD_CONFIG
- **THEN** the build uses that complete extension configuration and fails on an invalid override without falling back or combining configuration sources

#### Scenario: Invalid or credential-bearing input
- **WHEN** build configuration includes unsupported credential fields or malformed endpoint values
- **THEN** the build rejects it without exposing those values in logs or assets

### Requirement: GitHub receives the validated archive from the merged source

Publication SHALL occur only after the exact ZIP has passed archive, manifest, profile and checksum validation. Each Release SHALL provide the installable extension ZIP and SHA256SUMS, and its tag SHALL resolve to the validated merged commit. Publication SHALL use the GitHub workflow token and MUST NOT publish to npm or a browser store. Extension Releases MUST NOT replace the monorepo's global Latest selection.

#### Scenario: Validated archive is published
- **WHEN** an eligible channel build completes package validation
- **THEN** its exact ZIP and checksum are attached to the matching source tag's GitHub Release

#### Scenario: Package validation fails
- **WHEN** the archive is corrupt or its manifest, profile or checksum differs from the expected release
- **THEN** publication stops before creating or modifying distribution outputs

### Requirement: Retries preserve published identity and bytes

Retries SHALL reuse matching tags and assets or complete missing publication outputs. Conflicting tag targets, Release state, duplicate assets or differing bytes MUST fail without moving tags or replacing published assets. A queued event SHALL retain its original source revision even if the branch advances.

#### Scenario: Upload fails after one asset succeeds
- **WHEN** the original workflow is retried after a partial asset-upload failure
- **THEN** it retains matching outputs and uploads only missing assets

#### Scenario: Existing tag or asset conflicts
- **WHEN** a selected tag points to another commit or an existing attachment has different bytes
- **THEN** the workflow fails without overwriting or deleting the published output

#### Scenario: Branch advances while a release waits
- **WHEN** a validated release event runs after later merges reach the same branch
- **THEN** it builds and tags its original merged commit while requiring that commit to remain in that branch's history
