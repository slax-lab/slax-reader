# Spec Delta

## Purpose

This capability lets an authenticated Reader user create a private copy of a readable Reader snapshot, while ensuring same-user same-URL saves always publish the newest successful data without exposing or mutating another user's private content.

## ADDED Requirements

### Requirement: Private snapshot fork

The system SHALL provide an authenticated Fork operation that accepts a Reader user-bookmark UUID, validates the source with the same read-access policy used by `/b/<uuid>`, and copies stored content without fetching the source URL from the network.

#### Scenario: Fork a readable shared article

- **WHEN** an active authenticated user forks a readable source article with complete stored content
- **THEN** the system publishes a private destination for that user, returns its stable user-bookmark UUID, and marks the write as created or overwritten

#### Scenario: Reject an unreadable source

- **WHEN** the source is missing, deleted, moderated, pending, failed, content-less, or not currently readable under the source sharing policy
- **THEN** the system rejects the operation with a typed business error and does not publish destination content

#### Scenario: Fork does not fetch the original URL

- **WHEN** a Fork operation succeeds
- **THEN** all article/PDF content comes from the source Reader snapshot's stored objects and no ordinary crawl workflow is enqueued

### Requirement: Same-user same-URL newest-data-wins

The system SHALL maintain one current private destination for each full stored target URL and positive authenticated user ID. A newer direct capture or Fork SHALL replace the previous body, sidecars, article metadata, and current Fork attribution while preserving the destination user-bookmark UUID when one already exists.

#### Scenario: Fork overwrites an existing private URL

- **WHEN** the destination user already has a private bookmark for the full stored source URL
- **THEN** the new Fork content replaces the current content and the response identifies the write as `overwritten`

#### Scenario: Direct capture clears stale Fork attribution

- **WHEN** a direct capture successfully replaces a destination that previously came from a Fork
- **THEN** the current Fork attribution is cleared together with the content publication

#### Scenario: Other users remain isolated

- **WHEN** another user saves or forks the same URL
- **THEN** the first user's private content, R2 objects, metadata, and current attribution remain unchanged

#### Scenario: Historical public rows are preserved

- **WHEN** a new private write targets a URL with an existing `private_user = 0` row
- **THEN** the private write creates or updates only the positive-user row and never overwrites the historical public row

### Requirement: Publish-safe content storage

The system SHALL publish new HTML, text, and supported PDF body/text/meta objects under destination-owned keys or revisions before switching the database pointers, and SHALL preserve the last successful destination version when copying or committing a new version fails.

#### Scenario: Article copy publishes atomically from the reader's perspective

- **WHEN** new article objects are copied successfully and the database publication commits
- **THEN** content readers resolve the committed keys and do not observe a mixed old/new body or sidecar set

#### Scenario: Copy failure preserves the previous version

- **WHEN** R2 copying or database publication fails after a previous version exists
- **THEN** the previous version remains readable and unpublished new objects are eligible for cleanup/retry

#### Scenario: PDF keys are derived from actual source metadata

- **WHEN** a supported PDF is forked
- **THEN** the source body key and its derived text/meta sidecars are copied from the source record's actual content key, not guessed from a UUID

### Requirement: Fork lineage and source privacy

The system SHALL record the current source-to-destination lineage separately from user bookmark metadata, and SHALL apply the existing per-share `show_userinfo`, owner, and `snapshot_sharing` policy when storing and displaying source identity.

#### Scenario: Visible source identity

- **WHEN** the source policy permits user information
- **THEN** the destination may show the stored source display snapshot and source `/b/<uuid>` link

#### Scenario: Hidden source identity

- **WHEN** the source policy hides user information
- **THEN** the destination does not expose the source user's name or avatar and uses anonymous/source-link presentation

#### Scenario: Source sharing is later revoked

- **WHEN** the source owner disables sharing or deletes the source after a successful Fork
- **THEN** the completed private destination remains readable and its stored lineage/content is not automatically mutated

### Requirement: Reader URL compatibility

The system SHALL recognize only canonical, strictly validated Reader `/b/<uuid>` URLs before URL normalization, short-link resolution, external fetching, or ordinary URL policy, and SHALL route recognized URLs to the Fork operation across supported URL-save entry points.

#### Scenario: Strict `/b` URL routes to Fork

- **WHEN** a supported URL-save entry receives a canonical Reader origin with exactly `/b/<uuid>`
- **THEN** it invokes Fork and never enqueues an ordinary crawl

#### Scenario: Malformed or external `/b` URL is not treated as Reader content

- **WHEN** the URL has an alternate origin, unsafe authority, malformed UUID/path, or disallowed query
- **THEN** it is rejected or handled by ordinary URL policy and cannot select an arbitrary source bookmark

### Requirement: Web Fork action

The Web snapshot page SHALL expose a touch-safe Fork action to authenticated/anonymous visitors only when the source metadata says it is readable and forkable, preserve the source URL through login, and display the current Source and Fork attribution separately.

#### Scenario: Visitor sees and uses Fork

- **WHEN** a visitor opens a readable other-user `/b/<uuid>` page and activates Fork
- **THEN** the UI shows progress, prevents duplicate submissions, and navigates to the returned destination snapshot after success

#### Scenario: Anonymous visitor is sent through login

- **WHEN** an anonymous visitor activates Fork
- **THEN** the UI opens login and preserves the original `/b/<uuid>` route for the post-login action

#### Scenario: Owner does not see a self-fork action

- **WHEN** the owner views their own snapshot
- **THEN** the visitor Fork action is hidden

### Requirement: Private object lifecycle and bounded maintenance

The system SHALL retire replaced object revisions atomically with publication, durably enqueue all private objects for cleanup when their bookmark or account is deleted, and preserve other users' independent Fork copies. Cleanup and repair queries SHALL use bounded batches and query-appropriate indexes.

#### Scenario: Preserve full URL identity

- **WHEN** a saved URL contains query parameters that are unnecessary for fetching
- **THEN** storage, overwrite matching, and Source preserve those parameters while fetching may use a separate prepared URL

#### Scenario: Replace and collect a private revision

- **WHEN** a new revision commits successfully
- **THEN** the previous private revision is retired in that transaction and becomes eligible for retryable cleanup after the grace period, while the current revision remains protected

#### Scenario: Delete private content without deleting another user's Fork

- **WHEN** an owner permanently deletes a bookmark or account
- **THEN** all owned revisions and target-owned bookkeeping are queued or removed, including legacy private pointers, and other users' completed Fork copies and stored attribution remain intact

#### Scenario: Cleanup fails or workers overlap

- **WHEN** cleanup fails or multiple maintenance workers run concurrently
- **THEN** bounded claims use cleanup tokens, failures remain retryable, and completed tombstones are removed only after the repeat-cleanup window and another successful object deletion
