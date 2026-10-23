# Spec Delta

## Purpose

Ensure new personal captures and Forks own coherent saved content that another user's later actions cannot replace, while preserving format fidelity, access policy and explicit failure boundaries for partial publication.

## ADDED Requirements

### Requirement: Independent ownership across new captures

New Extension, URL, import and synchronized captures and new Forks SHALL own their saved content under the destination user. Another user's save, re-save, generation or retry of the same resource SHALL NOT replace a completed private snapshot's body, metadata or supplementary media content. Explicit owner refresh of an ordinary capture SHALL remain supported. This guarantee SHALL NOT be represented as a completed migration of historical shared records.

#### Scenario: Same ordinary URL for two users
- **WHEN** A and B save and re-save the same external URL
- **THEN** B's actions do not alter A's saved content, content pointers or personal state

#### Scenario: New media save with shared computation
- **WHEN** A has a completed new YouTube or podcast snapshot and B saves, generates or retries that same medium
- **THEN** A's body, ready variants and displayed processing state remain unchanged

#### Scenario: Owner requests a new revision
- **WHEN** A explicitly refreshes or retries A's ordinary media capture
- **THEN** only A's selected capture can advance and a late completion for its previous revision cannot overwrite the new revision

#### Scenario: Owner independently recaptures a media Fork
- **WHEN** the owner saves the original media URL and the independent acquisition publishes successfully
- **THEN** the destination becomes an ordinary private capture with newly pinned inputs/components, clears Fork provenance in the same transaction, and retains its UUID and personal state
- **AND** ordinary status settlement, policy updates and repeated Reader-URL Fork commands do not perform this conversion

### Requirement: Coherent publication and recovery

A successful snapshot SHALL expose a coherent set of required content artifacts. All required writes SHALL finish before recording success. Failed in-place writes may leave partially replaced objects and SHALL NOT claim an automatic rollback. Uncertainty about database commit SHALL NOT cause deletion of potentially committed content. Post-commit indexing or notification failures SHALL NOT destroy the snapshot. Immediate deletion SHALL target only a confirmed unpublished new destination or a permanently deleted bookmark; failed updates SHALL NOT delete the live fixed keys.

#### Scenario: Partial object copy
- **WHEN** one required artifact cannot be read or written
- **THEN** a new destination is not marked successful; an admitted or existing destination reports failure without deleting its live files, source files or competing-winner files

#### Scenario: Commit succeeds but acknowledgement is lost
- **WHEN** the destination commits and the caller observes a database timeout
- **THEN** reconciliation preserves the committed objects and a retry returns the canonical destination

#### Scenario: Source changes during transfer
- **WHEN** the source writer replaces content during a snapshot transfer
- **THEN** the result is one validated revision or a retryable failure, never old HTML paired with unrelated new text

#### Scenario: Process exits before publication
- **WHEN** an attempt leaves objects without publishing a destination
- **THEN** no completed destination is exposed and remaining objects may persist without automatic reclamation

### Requirement: Best-effort snapshot lifecycle deletion

The system SHALL retain existing R2 directories and UUID filenames for HTML, text, PDF and PDF metadata, and attempt immediate content deletion after permanent bookmark/account deletion. Failed deletion SHALL NOT undo the successful database operation. It SHALL NOT add a cleanup table, cleanup state fields, R2 inventory scans or scheduled orphan reclamation. Existing bounded media settlement and index repair SHALL remain available.

#### Scenario: Pointer replacement or permanent deletion rolls back
- **WHEN** the database transaction fails or its outcome remains uncertain
- **THEN** potentially live content is retained

#### Scenario: Successful replacement
- **WHEN** an in-place update is confirmed published
- **THEN** the same fixed keys remain readable and no retired-bundle deletion is performed

#### Scenario: Immediate deletion fails
- **WHEN** R2 deletion fails or the worker exits after the database operation
- **THEN** the completed operation remains successful and residual objects may persist without a cleanup retry record

#### Scenario: Scheduled maintenance
- **WHEN** snapshot maintenance runs
- **THEN** it performs bounded media settlement and index repair without collecting orphan objects

### Requirement: Article and shortcut fidelity

Article snapshots SHALL retain the captured body and a corresponding text representation without copying source-user state. Shortcuts SHALL retain their type, saved target and title without fabricating an article body or traversing their target. Externally referenced assets SHALL retain existing resource behavior; Fork SHALL NOT claim to archive every external resource.

#### Scenario: Article with personal annotations
- **WHEN** an article with source-user marks, tags, aliases and AI conversations is Forked
- **THEN** its article content is copied and destination user state starts independently without those personal records

#### Scenario: Bodyless shortcut
- **WHEN** a readable shortcut snapshot is Forked
- **THEN** the result remains a usable private shortcut with provenance and no unnecessary content generation

### Requirement: Independent PDF snapshot

PDF Forks SHALL own their binary, extraction descriptor and any available extracted text independently. They SHALL retain byte identity for highlights and the existing preview, file-access and byte-range behavior. Uploaded copies SHALL deduplicate with the destination user's native upload of identical bytes. Incomplete or inconsistent extraction SHALL report source-not-ready; terminal empty or failed extraction SHALL preserve a readable PDF with unavailable text analysis.

#### Scenario: Delete source PDF
- **WHEN** a source PDF is permanently deleted after Fork
- **THEN** the destination binary, preview, descriptor and available text remain readable and new destination highlights can be created

#### Scenario: Identical uploaded file
- **WHEN** a user Forks an uploaded PDF and subsequently uploads identical bytes
- **THEN** both operations resolve to the same personal resource identity without copying the source owner's synthetic URL namespace

#### Scenario: Pending extraction
- **WHEN** the source binary exists but its extraction descriptor is pending or inconsistent with its text
- **THEN** Fork reports not-ready rather than creating a destination that polls forever

#### Scenario: Scanned or extraction-failed PDF
- **WHEN** a valid source PDF has terminal empty or failed extraction
- **THEN** Fork preserves file reading and explicitly unavailable text analysis without inventing text or starting extraction

### Requirement: Frozen media presentation

YouTube and podcast Forks SHALL retain their currently readable base presentation, player/cues and all currently authorized ready supplementary article or translation variants. Missing, failed or still-generating supplementary components SHALL become fixed unavailable states. Reading a Fork SHALL NOT generate, retry, switch source versions or retrieve replacement content from mutable canonical records. Playback SHALL continue using the existing external media URLs.

#### Scenario: YouTube fallback article
- **WHEN** the source retains an annotated transcript body and shows a ready generated article below it
- **THEN** Fork preserves both readable content surfaces and the player/cues without copying the annotations

#### Scenario: Podcast with translation
- **WHEN** a source podcast has a ready body and translation
- **THEN** Fork preserves both, including paragraph-time mapping, after the source transcript or canonical translation is replaced

#### Scenario: Source generation still running
- **WHEN** a successful player/show-notes base is Forked while supplemental generation is running
- **THEN** the base is copied, the absent supplement is terminally unavailable, and later source completion does not change the Fork

#### Scenario: Missing private media artifact
- **WHEN** a managed media snapshot's required private artifact is missing
- **THEN** reading reports the failure without reconnecting the bookmark to mutable canonical content

### Requirement: Bounded initial media completion

For new ordinary media captures, only processing requested by the capture's owner SHALL complete its pending components. The captured media input identity SHALL be preserved; results for changed inputs SHALL NOT be substituted silently. The first terminal result SHALL remain fixed until an explicit owner action opens a new revision. Private versions SHALL be distinguishable by downstream reader caches.

#### Scenario: First generation completes
- **WHEN** the pending generation requested by A's save completes for its pinned input
- **THEN** A's private snapshot obtains that result once and later unrelated canonical retries cannot replace it

#### Scenario: Shared episode changed while pending
- **WHEN** another save changes the shared episode input before A's requested result completes
- **THEN** A consumes only a matching result or sees an unavailable component with owner recovery, never content from an unrequested input

#### Scenario: Retry reuses provider version labels
- **WHEN** an owner refresh produces different content with the same provider hash/language/prompt identifiers
- **THEN** the destination revision changes and reader caches do not keep the previous payload as current

### Requirement: Independent lifecycle preserves content policy

Source deletion, ordinary editing or sharing revocation SHALL NOT delete or replace the destination snapshot. Existing global media moderation and takedown controls SHALL continue to reach independently owned copies. Destination deletion SHALL remove its own private artifacts without deleting source or other users' copies.

#### Scenario: Source share disabled
- **WHEN** the source owner disables sharing after a successful Fork
- **THEN** destination content follows its own access policy and source attribution becomes unavailable where appropriate

#### Scenario: YouTube takedown
- **WHEN** the existing administration flow takes down derived content for a video
- **THEN** the prohibited derived content is removed from affected private bodies and supplementary snapshots under the existing takedown semantics

#### Scenario: Publication races with takedown
- **WHEN** a Fork or private revision publishes while media takedown is enumerating affected bookmarks
- **THEN** the new snapshot cannot expose the taken-down derived content through body, supplemental endpoints or cached presentation, even if it was absent from the initial enumeration

#### Scenario: Podcast moderation
- **WHEN** the existing transcript moderation flow flags an episode
- **THEN** affected private copies remain included in moderation and sharing-disable enforcement

#### Scenario: Delete a destination
- **WHEN** the destination owner permanently deletes a Fork
- **THEN** its private bundle and policy reference are cleaned without deleting any source or competing destination artifacts

### Requirement: Existing-state write admission

Content updates SHALL reuse existing status fields without a database version, lease or cleanup table. Accepted ordinary saves SHALL transition completed records to pending and failed records to pending_retry. Busy submissions SHALL NOT change the running request timestamp or payload. A Workflow SHALL atomically claim pending/pending_retry as parseing, binding the accepted request timestamp, in a separate durable step. Duplicate or stale executions SHALL return before content side effects. In-step finite retries SHALL remain supported. Rescue SHALL preserve the pending state until claimed, retain its existing selection window, and SHALL NOT steal parseing tasks. Fork and private media publication SHALL use conditional state admission at their direct write boundary.

#### Scenario: Resave a completed article
- **WHEN** an owner submits an existing completed external URL
- **THEN** it is admitted as pending, fetched/parsed again and written to the same private conventional keys before success

#### Scenario: Original and rescued Workflow race
- **WHEN** normal and rescue Workflows run for the same accepted pending request
- **THEN** only one claims it and the other exits without altering status, R2 or import counts

#### Scenario: Same execution retries
- **WHEN** a claimed Workflow's fetch step fails transiently
- **THEN** its existing finite step retries may continue despite parseing, while a separate duplicate execution cannot claim it

#### Scenario: Interrupted fixed-key update
- **WHEN** execution stops after claiming or after writing only some required objects
- **THEN** the system does not delete the live fixed keys or promise automatic restoration, and does not add timeout takeover or orphan recovery infrastructure

#### Scenario: Frontend submission guard
- **WHEN** a save has been accepted but its content work remains pending or parsing
- **THEN** the relevant frontend entry rejects re-entry for that resource, using existing loading and synced status; unrelated resources remain usable and the backend remains authoritative across devices
