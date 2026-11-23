# Spec Delta

## MODIFIED Requirements

### Requirement: The snapshot detail page upgrades to local data only for a verified owner

After deferred startup completes on a `/b/[id]` document, the page SHALL switch marks, title, archive and star state, and reading position to local data only when the current content response marks the reader as owner, the local database owner equals the current token's account, the account generation is unchanged since the page started waiting, and the bookmark exists locally. The switch SHALL NOT reload the article body. Otherwise the page SHALL remain on REST. A switch that happens after the page has become readable SHALL restore the saved reading position once, as a switch before the page became readable does, unless the reader has already scrolled, navigated within the article, or opened it with a highlight or fragment; until the switch, the page SHALL NOT clear or overwrite the saved reading position.

#### Scenario: Owner bookmark after readiness
- **WHEN** deferred startup completes and every ownership condition holds
- **THEN** the page switches to local data without reloading the article body

#### Scenario: The switch does not flash
- **WHEN** an owner page switches from REST to local data and the local rows match what is already shown
- **THEN** the title, highlights, highlight styles, and archive and star state remain visually unchanged across every rendered frame

#### Scenario: Local data lags behind REST
- **WHEN** the local rows lack a highlight, a comment, or a deletion that the REST response already showed
- **THEN** the page keeps showing the REST highlights until the local rows cover them
- **AND** a highlight the reader writes on the page appears from the local rows immediately

#### Scenario: A highlight written before the switch
- **WHEN** the reader adds or deletes a highlight or comment while the page still uses REST, and the page then switches to local rows that do not yet include that change
- **THEN** the page keeps showing the change until the local rows cover it

#### Scenario: Reading position after a late switch
- **WHEN** the page becomes readable from REST, the reader does not scroll, and the switch to local data happens later
- **THEN** the page scrolls once to the saved reading position after the switch
- **AND** leaving the page before the switch keeps the saved reading position

#### Scenario: Reader scrolls before a late switch
- **WHEN** the reader scrolls before the switch to local data
- **THEN** the switch does not move the page, and later captures save the reader's position

#### Scenario: Visitor or another account
- **WHEN** the reader does not own the bookmark, or the local database belongs to another account
- **THEN** the page never switches to local data

#### Scenario: Account changes while waiting
- **WHEN** the account generation or token changes before deferred startup completes
- **THEN** the page does not switch to local data for the earlier account

### Requirement: Leaving a deferred document gives the destination normal startup

When a deferred document navigates to a path outside the deferrable routes, the navigation SHALL load the destination as a new document so that it runs its normal startup, after waiting a bounded time for in-progress local startup. Navigation among deferrable routes SHALL stay client-side. A browser history traversal (Back or Forward) out of a deferred document SHALL reach its destination as well.

#### Scenario: Reader returns to the Inbox
- **WHEN** a deferred `/b/[id]` document navigates to `/bookmarks`
- **THEN** the destination loads as a new document with its normal local-first startup
- **AND** the old document does not mount the Inbox

#### Scenario: Reader opens another article
- **WHEN** a deferred `/b/[id]` document navigates to another `/b/[id]`
- **THEN** the navigation stays client-side

#### Scenario: Back after reloading an article
- **WHEN** the reader opens an article from the Inbox, reloads it, and presses the browser Back button
- **THEN** the Inbox loads as a new document with its normal local-first startup

### Requirement: Deferrable reader documents do not wait for local database startup

A top-level document initially opened at `/b/[id]`, `/user`, or `/collection/manage`, outside the extension bridge, the anonymous public bypass, and snapshot session recovery, SHALL mount and become interactive without waiting for local database initialization, data-version migration, or account ownership checks. It SHALL start that startup in the background. Until the document's own startup completes those checks, every local-data consumer on it SHALL behave as when local mode is unavailable. Every other document SHALL keep its existing blocking startup. A top-level document at the extension bridge path, with or without a trailing slash, which is only meaningful inside the extension frame, SHALL behave as when local mode is unavailable and SHALL NOT start local database startup or synchronization.

#### Scenario: Local startup is slow on a reader document
- **WHEN** a signed-in reader opens `/b/[id]` while local database initialization is delayed
- **THEN** the page mounts and its article, links, highlight tools, and panels respond without waiting for the delay
- **AND** marks, highlights, comments, archive, star, and title edits use the existing REST path

#### Scenario: Settings while local startup is slow
- **WHEN** a signed-in reader opens `/user` while local database initialization is delayed
- **THEN** the page mounts without waiting and shows its REST content and notifications

#### Scenario: Startup checks fail
- **WHEN** deferred startup times out, fails data-version migration, or fails the account ownership check
- **THEN** the document stays on REST for its lifetime and no local row is read

#### Scenario: Other entry routes
- **WHEN** a document initially opens at `/`, `/bookmarks`, the extension bridge frame, or a route not listed above
- **THEN** existing startup, recovery, ownership, onboarding readiness, and REST fallback behavior applies unchanged

#### Scenario: Extension bridge opened outside a frame
- **WHEN** a signed-in user opens `/x/ext-bridge` or `/x/ext-bridge/` directly as a top-level page
- **THEN** no local database is opened and no synchronization connection is made

## ADDED Requirements

### Requirement: The extension bridge path is framed only by the extension

Every URL form that serves the extension bridge page, including a trailing slash, SHALL carry the `frame-ancestors` policy that allows only the configured extension.

#### Scenario: Trailing-slash bridge URL
- **WHEN** `/x/ext-bridge/` is requested
- **THEN** the response carries the same `frame-ancestors` policy as `/x/ext-bridge`
