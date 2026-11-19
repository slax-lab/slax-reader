# Spec Delta

## ADDED Requirements

### Requirement: Deferrable reader documents do not wait for local database startup

A top-level document initially opened at `/b/[id]`, `/user`, or `/collection/manage`, outside the extension bridge, the anonymous public bypass, and snapshot session recovery, SHALL mount and become interactive without waiting for local database initialization, data-version migration, or account ownership checks. It SHALL start that startup in the background. Until the document's own startup completes those checks, every local-data consumer on it SHALL behave as when local mode is unavailable. Every other document SHALL keep its existing blocking startup.

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
- **WHEN** a document initially opens at `/`, `/bookmarks`, the extension bridge, or a route not listed above
- **THEN** existing startup, recovery, ownership, onboarding readiness, and REST fallback behavior applies unchanged

### Requirement: The snapshot detail page upgrades to local data only for a verified owner

After deferred startup completes on a `/b/[id]` document, the page SHALL switch marks, title, archive and star state, and reading position to local data only when the current content response marks the reader as owner, the local database owner equals the current token's account, the account generation is unchanged since the page started waiting, and the bookmark exists locally. The switch SHALL NOT reload the article body. Otherwise the page SHALL remain on REST.

#### Scenario: Owner bookmark after readiness
- **WHEN** deferred startup completes and every ownership condition holds
- **THEN** the page switches to local data without reloading the article body

#### Scenario: Visitor or another account
- **WHEN** the reader does not own the bookmark, or the local database belongs to another account
- **THEN** the page never switches to local data

#### Scenario: Account changes while waiting
- **WHEN** the account generation or token changes before deferred startup completes
- **THEN** the page does not switch to local data for the earlier account

### Requirement: Leaving a deferred document gives the destination normal startup

When a deferred document navigates to a path outside the deferrable routes, the navigation SHALL load the destination as a new document so that it runs its normal startup, after waiting a bounded time for in-progress local startup. Navigation among deferrable routes SHALL stay client-side.

#### Scenario: Reader returns to the Inbox
- **WHEN** a deferred `/b/[id]` document navigates to `/bookmarks`
- **THEN** the destination loads as a new document with its normal local-first startup
- **AND** the old document does not mount the Inbox

#### Scenario: Reader opens another article
- **WHEN** a deferred `/b/[id]` document navigates to another `/b/[id]`
- **THEN** the navigation stays client-side

### Requirement: The snapshot detail body stays server-rendered

The snapshot detail page SHALL keep its article body in the initial server-rendered HTML for requests the server renders today, including anonymous edge-cached responses. Deferring local startup SHALL NOT replace the server-rendered body with a client-only loading state.

#### Scenario: Anonymous visitor opens a public snapshot
- **WHEN** an anonymous visitor requests `/b/[id]`
- **THEN** the initial HTML contains the article title, metadata, and first-screen body as before
