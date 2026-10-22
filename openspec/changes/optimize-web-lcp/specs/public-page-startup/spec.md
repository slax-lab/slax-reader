# Spec Delta

## Purpose

Allow anonymous visitors to see login and guide content without waiting for local database startup while preserving safe entry into authenticated and local-first reading surfaces.

## ADDED Requirements

### Requirement: Anonymous public entry does not require a local database

When public startup optimization is enabled, a top-level document initially opened at `/login` or `/guide`, with or without a trailing slash and without an authentication token, SHALL render without creating, initializing, migrating, clearing, or connecting a local database. Public login controls, locale, invitation information, and guide content SHALL retain their existing behavior. This route classification SHALL use the pathname, not query substrings.

#### Scenario: Database initialization would stall
- **WHEN** an anonymous visitor opens `/login` and the database initializer would never resolve
- **THEN** the initializer is not invoked
- **AND** the login page can mount and request its visible assets

#### Scenario: Anonymous guide with campaign parameters
- **WHEN** an anonymous visitor opens `/guide` with campaign query parameters or a fragment
- **THEN** the guide mounts without local database initialization
- **AND** those parameters retain their established meaning

#### Scenario: Authenticated or unrelated entry
- **WHEN** a document initially opens with a token, on another pathname, or inside the extension bridge
- **THEN** existing database startup, ownership, worker selection, recovery, and REST fallback behavior remains in effect without a new serial runtime-download dependency

#### Scenario: Token state cannot be read
- **WHEN** reading the initial token state fails
- **THEN** the visitor is not classified as anonymous for bypass
- **AND** existing normal startup or its unavailable fallback applies

### Requirement: Enter normal startup before leaving the bypassed public surfaces

A document that bypassed database startup SHALL keep local queries unavailable for that document's lifetime, including BFCache restoration. When navigation leaves `/login` or `/guide`, the reader SHALL perform one full document navigation to the resolved destination before mounting components on the destination. It SHALL preserve the destination path, query, and fragment and SHALL preserve existing authentication and redirect validation. Ordinary navigation between the public surfaces or within the same public page SHALL NOT require a reload. On BFCache restoration of a bypassed document, a newly present or unreadable token SHALL instead require one full navigation to the current destination to run normal startup or its fallback.

#### Scenario: Guide enters the reader
- **WHEN** a bypassed guide document navigates to the root Inbox or `/bookmarks`
- **THEN** a full document navigation runs normal startup before local-data components mount
- **AND** the destination is not permanently stuck on a database-unavailable branch

#### Scenario: OAuth callback and invitation continuity
- **WHEN** navigation from a bypassed document reaches an authentication callback or a post-login destination
- **THEN** existing callback, campaign, and redirect parameters are retained
- **AND** the new document applies existing account ownership checks before exposing local data

#### Scenario: Navigation is redirected by authentication
- **WHEN** a destination is redirected to login by existing authentication middleware
- **THEN** the transition does not introduce a reload loop or weaken redirect validation

#### Scenario: BFCache restores a bypassed document
- **WHEN** a bypassed public document is restored through browser back/forward and its token or cookie state has changed
- **THEN** a client-only `pageshow` handler re-evaluates the state while the restored document keeps local queries unavailable
- **AND** when the state is present or unreadable, one guarded full document navigation to the current path, query, and fragment starts normal startup or its fallback before destination local-query consumers mount

#### Scenario: BFCache restores an unchanged anonymous document
- **WHEN** a bypassed public document is restored and token state is still absent
- **THEN** the public page remains usable without a forced reload or local database access
- **AND** a subsequent exit still performs its required document navigation without a stale navigation lock

#### Scenario: Restore and route exit request navigation together
- **WHEN** a bypassed document's restore listener and route middleware request a full navigation during the same activation
- **THEN** only one full navigation is dispatched and destination local-data components do not mount in the old document
- **AND** fresh non-persisted page events and normal documents do not activate this restore rule

### Requirement: Preserve stored data and existing readiness guarantees

Bypassing anonymous startup SHALL NOT clear stored data, change database identity, discard pending local mutations, or establish authenticated account readiness. The normal startup path SHALL continue to block local queries until its existing migration and ownership checks complete. Public startup optimization SHALL be independently disableable at build time.

#### Scenario: Old account data remains on disk
- **WHEN** an anonymous user opens a bypassed public page with a previous account's database present
- **THEN** that database remains unopened and unmodified
- **AND** no local rows are exposed by the page

#### Scenario: Subsequent login changes accounts
- **WHEN** a visitor logs in as another account and enters a normal-startup document
- **THEN** the existing account transition guard runs before any local query
- **AND** existing onboarding readiness rules remain enforced

#### Scenario: Public optimization disabled
- **WHEN** a build disables public startup optimization
- **THEN** the application follows its prior startup path
- **AND** article image prioritization can remain enabled independently

### Requirement: Public startup changes preserve normal-user performance

The bypass SHALL preserve normal authenticated startup sequencing and SHALL NOT introduce a new serial runtime download before existing database initialization. Enablement SHALL be evaluated independently of article priority, against the pre-change application as well as all four switch combinations. A failing functional or normal-startup regression gate SHALL prevent release of the affected change.

#### Scenario: Public-only optimization with article priority disabled
- **WHEN** only anonymous public startup is enabled
- **THEN** anonymous login and guide avoid database initialization while authenticated Inbox, article, share, guide, and extension-bridge paths retain normal startup
- **AND** both switch-off rollback combinations remain covered by verification
