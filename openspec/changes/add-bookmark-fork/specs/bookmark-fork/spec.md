# Spec Delta

## Purpose

Allow readers to save an authorized Reader snapshot as an independent personal bookmark, with stable direct attribution and usable online entry points on desktop and mobile Web.

## ADDED Requirements

### Requirement: Authorized online Fork

The system SHALL let an authenticated active user copy a currently readable Reader snapshot through an online Fork command. It SHALL authorize the source and underlying acquisition feature before copying. The command SHALL return the committed destination bookmark UUID and a created or already-saved disposition. It SHALL NOT crawl the Reader page, refetch the original website or regenerate provider content during Fork.

#### Scenario: Copy a shared article
- **WHEN** a signed-in user Forks another user's accessible completed article
- **THEN** the user receives an independently owned readable bookmark and its destination UUID without a capture workflow

#### Scenario: Inaccessible source
- **WHEN** a visitor attempts to Fork an unshared, trashed, moderated or deleted-owner snapshot
- **THEN** the request reports unavailable without disclosing source identity or creating destination content

#### Scenario: Gate applies to resolved format
- **WHEN** a Reader link resolves to a format whose acquisition feature is disabled for the destination user
- **THEN** creation follows the existing feature-denial contract and does not bypass it through the Reader URL

#### Scenario: Source changes before publication
- **WHEN** source content, resource identity or permission changes before the final publication check
- **THEN** the command retries within a bound or reports not-ready/unavailable without publishing an unauthorized or mixed copy

### Requirement: Reader URL entry points share Fork behavior

Web URL entry, Extension HTML submission, REST URL submission, Telegram collection and supported bookmark imports SHALL recognize configured Reader origins with exact `/b/<UUID>` paths and dispatch to the same copy behavior. Query, fragment and trailing slash variants SHALL preserve the source identity. Lookalike origins and malformed identifiers SHALL NOT be accepted as Reader sources. Existing external-URL and `/s/` behavior SHALL remain supported.

#### Scenario: Extension sends Reader-shell HTML
- **WHEN** the Extension submits a recognized Reader URL with page HTML
- **THEN** the system copies the authorized source snapshot rather than parsing the supplied shell

#### Scenario: Web URL entry
- **WHEN** a connected Web user pastes a Reader article URL in the add dialog
- **THEN** the dialog uses online Fork without creating an optimistic local bookmark and the completed result synchronizes normally

#### Scenario: Import and Telegram complete a copy
- **WHEN** an import item or bound Telegram user submits an accessible Reader URL
- **THEN** the copy completes without a crawl, the entry reports its actual outcome, and only destination-requested tags/date/archive inputs are applied

#### Scenario: Saved-state lookup on Reader tabs
- **WHEN** the Extension revisits a Reader URL successfully collected by the user
- **THEN** its saved-state and sidebar resolve the user's destination even though its stored original target URL differs from the Reader tab URL

### Requirement: One personal copy per resource

Fork SHALL preserve the existing one-copy-per-user resource identity. A successful existing copy SHALL be returned without replacing content or provenance; a successful trashed copy SHALL be restored. An unfinished, failed or deletion-in-progress destination SHALL produce a distinguishable recovery outcome. A raw record without a live destination relation SHALL NOT be adopted.

#### Scenario: Repeated or concurrent Fork
- **WHEN** repeated clicks, concurrent saves or a lost-response retry address the same resource for one user
- **THEN** at most one personal copy is published and every successful response resolves to it

#### Scenario: Existing copy came from another source
- **WHEN** the user already has a successful original-URL capture or a Fork from another reader
- **THEN** Fork returns that copy unchanged, retaining its original body and provenance

#### Scenario: Own snapshot
- **WHEN** the owner Forks their own successful snapshot
- **THEN** the existing item is returned without creating a self-reference or another copy

#### Scenario: Pending, failed and deleting destinations
- **WHEN** the matching destination is parsing, terminally failed, or has lost its user relation during permanent deletion
- **THEN** the caller receives the corresponding in-progress, failed or deleting outcome without overwrite, resurrection or endless automatic retry

### Requirement: Stable direct provenance

Fork provenance SHALL be persisted in a dedicated nullable database field identifying the exact source user-bookmark relation. Client-supplied provenance SHALL NOT be trusted. Ordinary metadata edits and saves that reuse existing content SHALL preserve it. A successful independent owner acquisition SHALL clear provenance atomically with publishing its replacement content, retaining the destination identity and personal state. Source deletion SHALL preserve the fact that the destination was Forked. A Fork of a Fork SHALL record its immediate source.

#### Scenario: Source UUID reused
- **WHEN** the original relation is deleted and a different relation later uses the same public UUID
- **THEN** the old Fork shows an unavailable source and never attributes itself to the new relation

#### Scenario: Source relation rebound
- **WHEN** the referenced relation is rebound to a different resource
- **THEN** attribution becomes unavailable instead of linking to the unrelated resource

#### Scenario: Ordinary mutation after Fork
- **WHEN** the destination user changes tags, title alias, sharing, trash state or saves without independently acquiring replacement content
- **THEN** the provenance mapping is neither cleared nor replaced by client metadata

#### Scenario: Owner independently saves the original resource
- **WHEN** an owner's external-URL or inline acquisition successfully publishes replacement content for their Fork
- **THEN** the same destination UUID retains its personal state, its provenance becomes null in the publication transaction, and subsequent reader metadata has no Fork attribution

#### Scenario: Independent acquisition does not publish
- **WHEN** acquisition is pending, fails to fetch/write/commit, or loses the expected-revision publication guard
- **THEN** the previous Fork provenance is retained and no uncommitted content is presented as independently acquired

#### Scenario: Cached PDF save
- **WHEN** a save reuses a Fork's existing PDF binary, including duplicate native upload, title repair or text extraction
- **THEN** it retains provenance because no independently acquired replacement file is published

### Requirement: Safe Source and Fork attribution

The reader SHALL preserve its original Source presentation and add a Fork marker for Forked bookmarks. A public source link SHALL be shown only after authorizing both the destination and the exact source for the current viewer. Source-owner identity SHALL additionally obey the source's user-information visibility setting. Missing or inaccessible sources SHALL show a neutral unavailable label while the copied article remains readable. Viewer-specific source identity SHALL NOT enter shared HTML caches or another account's client state.

#### Scenario: Readable source with hidden owner identity
- **WHEN** the source is readable but its share hides user information from the viewer
- **THEN** Fork attribution uses a generic label and at most the permitted snapshot link, with no owner name, avatar or profile information

#### Scenario: Public copy with private source
- **WHEN** a source owner visits someone else's public Fork and later an anonymous viewer visits it
- **THEN** the anonymous viewer receives no privileged source name or link from the earlier visit's cached HTML

#### Scenario: Source sharing is revoked
- **WHEN** source access is revoked after copying
- **THEN** a fresh attribution request returns an unavailable marker while destination content remains accessible under its own policy

#### Scenario: Uploaded PDF attribution
- **WHEN** a Forked uploaded PDF is displayed
- **THEN** Source remains the local-upload filename presentation and Fork separately identifies the authorized Reader source without exposing a synthetic file URL

### Requirement: Mobile-friendly Fork action

Visitor Reader pages SHALL provide a reachable Fork action on desktop and mobile Web. Anonymous use SHALL open the existing login flow and return to the source for an explicit click. The action SHALL prevent duplicate submission, show loading and actionable failure states, and open the returned destination on success. It SHALL follow existing themes, focus, touch and reduced-motion requirements.

#### Scenario: Phone without an Extension
- **WHEN** a signed-in reader opens a supported shared snapshot at a 320px mobile width and activates Fork
- **THEN** the action remains reachable, copies the item and navigates to the user's destination

#### Scenario: Offline Fork attempt
- **WHEN** a user activates Fork or submits a Reader URL without a connection
- **THEN** the UI requests a connection, retains useful input and creates no offline Fork job or optimistic placeholder

#### Scenario: Anonymous reader returns from login
- **WHEN** an anonymous visitor uses Fork and completes login
- **THEN** the same source is restored and no copy is created until the user explicitly activates Fork again

### Requirement: Queued-client compatibility

Older queued Reader-URL creates SHALL have a durable terminal failed-save outcome with no copied body, provenance claim or background crawl. Their acknowledgement SHALL preserve unrelated sync mutations and dependent user edits. Replays SHALL NOT rebind unrelated existing identities, resurrect the failure into pending capture, or discard a successful personal copy. Ordinary external-URL offline saving SHALL remain supported.

#### Scenario: Mixed old-client batch
- **WHEN** a queued Reader-URL create and an unrelated note/tag edit upload together
- **THEN** the Reader save becomes visibly failed and removable, the unrelated edit completes, and neither item is retried forever because of a source-access failure

#### Scenario: Delayed dependent edits
- **WHEN** later queued edits reference the failed placeholder
- **THEN** they remain attached to that placeholder rather than silently moving to another bookmark

#### Scenario: Lost acknowledgement
- **WHEN** the same Reader placeholder transaction is replayed after its successful persistence response was lost
- **THEN** the stable failure state is retained without a new crawl or UUID reassignment

#### Scenario: Two devices queued the same Reader URL
- **WHEN** two devices upload valid creates for the same source URL with different local bookmark UUIDs
- **THEN** each UUID retains its own terminal failed placeholder and dependent edits, without violating resource uniqueness, blocking unrelated changes or merging notes into the other placeholder
