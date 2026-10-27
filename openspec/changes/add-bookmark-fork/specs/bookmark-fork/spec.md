# Spec Delta

## Purpose

Allow readers to save an authorized Reader snapshot as an independent personal bookmark, with stable direct attribution and usable online entry points on desktop and mobile Web.

## ADDED Requirements

### Requirement: Authorized online Fork

The system SHALL let an authenticated active user copy a currently readable Reader snapshot through an online Fork command. It SHALL authorize the source and underlying acquisition feature before copying. Interactive commands SHALL reuse POST /v1/bookmark/add_url and return its existing HTTP/envelope success and empty bmId acknowledgement after persisted admission, without waiting for R2 transfer or content success. Background copying SHALL use existing bounded Workflow execution and guarded status transitions. It SHALL NOT crawl the Reader page, refetch the original website or regenerate provider content during Fork.

#### Scenario: Copy a shared article
- **WHEN** a signed-in user Forks another user's accessible completed article
- **THEN** the user promptly receives the existing add_url acknowledgement, and background copying makes its required artifacts readable before marking success without fetching the original website

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
- **THEN** the dialog inserts the ordinary local pending bookmark and closes after local persistence, with existing PowerSync uploading and delivering the eventual Fork result; Web without local-first retains online add_url

#### Scenario: Import and Telegram complete a copy
- **WHEN** an import item or bound Telegram user submits an accessible Reader URL
- **THEN** the copy completes without a crawl, the entry reports its actual outcome, and only destination-requested tags/date/archive inputs are applied

#### Scenario: Saved-state lookup on Reader tabs
- **WHEN** the Extension revisits a Reader URL successfully collected by the user
- **THEN** its saved-state and sidebar resolve the user's destination even though its stored original target URL differs from the Reader tab URL

### Requirement: One personal copy per resource

Fork SHALL preserve the existing one-copy-per-user resource identity. Each accepted Fork of another source SHALL refresh an existing successful or failed private copy in place and update direct provenance after all necessary writes. A successful trashed copy SHALL be restored. An unfinished or deletion-in-progress destination SHALL report a distinguishable conflict without overwriting active work. Historical shared relations SHALL convert to private content without changing the user relation identity or losing personal state. A raw record without a live destination relation SHALL NOT be adopted.

#### Scenario: Repeated or concurrent Fork
- **WHEN** repeated clicks, concurrent saves or a lost-response retry address the same resource for one user
- **THEN** at most one personal copy is published and every successful response resolves to it

#### Scenario: Existing copy came from another source
- **WHEN** the user already has a successful original-URL capture or a Fork from another reader
- **THEN** Fork updates that same personal copy from the newly selected source, preserving its UUID and personal state

#### Scenario: Own snapshot
- **WHEN** the owner Forks their own successful snapshot
- **THEN** the existing item is returned without creating a self-reference or another copy

#### Scenario: Pending, failed and deleting destinations
- **WHEN** the matching destination is pending, parsing, or has lost its user relation during permanent deletion
- **THEN** the caller receives the corresponding in-progress or deleting outcome without overwrite, resurrection or endless automatic retry

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

Visitor Reader pages SHALL provide a reachable Fork action on desktop and mobile Web. Anonymous use SHALL open the existing login flow and return to the source for an explicit click. The action SHALL prevent duplicate submission, show request loading and actionable failure states, and remain on the source after acceptance. On each visit the action SHALL use viewer-scoped persisted Fork status to disable an active or successful copy and permit explicit retry of a failed copy. It SHALL follow existing themes, focus, touch and reduced-motion requirements.

#### Scenario: Phone without an Extension
- **WHEN** a signed-in reader opens a supported shared snapshot at a 320px mobile width and activates Fork
- **THEN** the action remains reachable, acknowledges the save without waiting for copying and stays on the source page with the Fork button disabled

#### Scenario: Offline Fork attempt
- **WHEN** a user activates Fork or submits a Reader URL without a connection
- **THEN** the UI requests a connection, retains useful input and creates no offline Fork job or optimistic placeholder

#### Scenario: Anonymous reader returns from login
- **WHEN** an anonymous visitor uses Fork and completes login
- **THEN** the same source is restored and no copy is created until the user explicitly activates Fork again

### Requirement: PowerSync Reader submission

Reader-URL creates SHALL use the existing local bookmark shape, connector and sync endpoint. The server SHALL resolve the trusted source and reuse existing authorized Fork admission and copying. Newly created relations SHALL use the submitted client UUID; existing destinations SHALL retain their UUID and personal state under ordinary-save semantics. No additional schema, bucket or provenance-sync field SHALL be required. Ordinary-only sync batches SHALL retain their existing transaction and retry behavior.

#### Scenario: Local acceptance before slow upload
- **WHEN** a connected user submits a Reader URL or activates Fork while the upload endpoint is slow
- **THEN** local insertion ends the loading state without waiting for HTTP admission or R2 copying, and no immediate server-detail refresh clears that local acknowledgement

#### Scenario: Mixed batch and dependent edit
- **WHEN** a Reader create appears between ordinary operations, including a personal edit of its newly created UUID
- **THEN** preceding operations commit first, the existing Fork admission commits next, and the later edit sees that destination

#### Scenario: Source rejected during upload
- **WHEN** a queued source is missing, unavailable, denied or blocked by an acquisition gate
- **THEN** the existing terminal Reader failure writer retains its local UUID with no copied content or provenance, and unrelated subsequent mutations continue

#### Scenario: Persisted create is replayed
- **WHEN** a queued create already has a private relation owned by the submitting user at its client UUID
- **THEN** acknowledge it without readmitting the source, preserve successful, active or failed state and personal edits, and continue later operations even after source deletion or permission changes
- **AND** a UUID belonging to another user does not satisfy this check

#### Scenario: Existing destination and lost response
- **WHEN** a queued create finds an existing personal destination or is replayed after a lost response
- **THEN** resource uniqueness and existing UUID are preserved using ordinary-save semantics; a terminal save may refresh again, and no permanent UUID alias or exactly-once receipt is introduced

#### Scenario: Busy destination or uncertain dispatch
- **WHEN** admission finds an active destination or cannot confirm its already reserved Workflow dispatch
- **THEN** sync acknowledges the existing save, retains its active claim and permits unrelated operations without creating another failure placeholder or starting ordinary URL capture

#### Scenario: Infrastructure failure before admission
- **WHEN** database or network failure prevents admission
- **THEN** the sync upload remains retryable through the existing connector and does not execute later operations

#### Scenario: Deliberate repeat after completion
- **WHEN** the owner Forks a source again after the previous request completes
- **THEN** the existing destination is refreshed even when source bytes are unchanged, without creating another personal bookmark or adding version fields

#### Scenario: Overlapping operations
- **WHEN** Fork and ordinary capture address the same private destination concurrently
- **THEN** only one operation may write its conventional destination keys and the other reports busy without changing active inputs

#### Scenario: Revisiting a Forked source
- **WHEN** a signed-in viewer revisits a source whose live personal Fork is pending or successful
- **THEN** the Fork action is disabled from account-specific server metadata, even without local PowerSync data

#### Scenario: Failed or deleted personal copy
- **WHEN** copying has failed or the viewer deletes the personal copy
- **THEN** fresh source metadata permits a new explicit Fork submission and never exposes another viewer's status

#### Scenario: Slow copy and final failure
- **WHEN** required R2 copying is delayed or eventually fails after bounded retries
- **THEN** the already-admitted HTTP request is not held open, and the persisted destination remains processing until success or a guarded failed transition

#### Scenario: Duplicate arrives before durable dispatch is confirmed
- **WHEN** a concurrent duplicate finds an admitted active destination whose deterministic Workflow is not confirmed
- **THEN** it reports the existing dispatch-uncertainty error instead of success, retains the claim, and does not create a second Workflow

### Requirement: Shared detail projection and account isolation

Existing public and authenticated private detail queries SHALL supply safe Fork attribution and viewer_fork_status. The button and article SHALL consume the same page detail rather than dedicated Fork metadata requests. The button SHALL submit a configured Reader URL through ordinary local insertion and PowerSync when available, retaining add_url as the existing non-local-first fallback. Explicit URL submission SHALL retain refresh semantics even when a completed copy disables the button.

#### Scenario: Authenticated SSR cache isolation
- **WHEN** a Reader request carries a token cookie or Authorization header, including invalid credentials
- **THEN** both shared-cache lookup and storage are bypassed with private, no-store, and the backend authenticates the viewer

#### Scenario: Anonymous shared cache
- **WHEN** an anonymous Reader page is cached
- **THEN** it contains neutral Fork attribution and null viewer status, with existing permission/revision revalidation retained

#### Scenario: Account changes during detail loading
- **WHEN** login, logout, account or route changes while detail is loading
- **THEN** prior privileged detail is cleared immediately and late responses cannot populate the new context, including while offline

#### Scenario: PDF hydration
- **WHEN** PDF details render on the server
- **THEN** hydration retains the title/type-only placeholder and the existing client detail refresh supplies the descriptor and Fork projection

#### Scenario: Accepted save followed by detail refresh failure
- **WHEN** add_url accepts a Fork but refreshing detail fails
- **THEN** the page stays on the source with its account/source action disabled and does not report the accepted save as failed
