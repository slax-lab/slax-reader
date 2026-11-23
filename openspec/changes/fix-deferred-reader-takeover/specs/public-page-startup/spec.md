# Spec Delta

## MODIFIED Requirements

### Requirement: Anonymous public entry does not require a local database

When public startup optimization is enabled, a top-level document initially opened at `/`, `/login`, or `/guide` with a confirmed absent authentication token SHALL reach its public content without creating, initializing, migrating, clearing, or connecting a local database. Public login controls, locale, invitation information, and guide content SHALL retain their existing behavior. Login and guide accept a trailing slash. This route classification SHALL use the pathname.

#### Scenario: Database initialization would stall
- **WHEN** an anonymous visitor opens `/login` and the database initializer would never resolve
- **THEN** the initializer is not invoked
- **AND** the login page can mount and request its visible assets

#### Scenario: Anonymous guide with campaign parameters
- **WHEN** an anonymous visitor opens `/guide` with campaign query parameters or a fragment
- **THEN** the guide mounts without local database initialization
- **AND** those parameters retain their established meaning

#### Scenario: Anonymous root enters login
- **WHEN** an anonymous visitor opens the top-level root with query parameters or a fragment
- **THEN** the root enters the existing login redirect with the full return URL and supported attribution
- **AND** no database initialization, root Inbox mount, or root document reload occurs
- **AND** query text naming an auth route does not exempt the root from redirecting

#### Scenario: Authenticated or unrelated entry
- **WHEN** a document initially opens with a token, on another pathname, or inside the extension bridge frame
- **THEN** existing database startup, ownership, worker selection, recovery, and REST fallback behavior remains in effect without a new serial runtime-download dependency
- **AND** the extension bridge path opened as a top-level page starts no local database, as required by the deferred reader startup requirement

#### Scenario: Token state cannot be read
- **WHEN** reading the initial token state fails
- **THEN** the visitor is not classified as anonymous for bypass
- **AND** existing normal startup or its unavailable fallback applies

### Requirement: Public startup changes preserve normal-user performance

The bypass SHALL preserve normal authenticated startup sequencing and SHALL NOT introduce a new serial runtime download before existing database initialization. Enablement SHALL be evaluated independently of article priority, against the pre-change application as well as all four switch combinations. That comparison, the cached-share rollback drill, and the login/guide/account-switch flow checks are post-release obligations (revised 2026-11-02), not pre-enablement gates: both switches ship enabled by default. A failing functional or normal-startup regression discovered by those obligations SHALL be corrected by disabling the affected switch in `apps/web/app/app.config.ts` and deploying, and SHALL block release until resolved.

#### Scenario: Public-only optimization with article priority disabled
- **WHEN** only anonymous public startup is enabled
- **THEN** anonymous root, login, and guide avoid database initialization while authenticated Inbox, article, share, and guide paths and the extension bridge frame retain normal startup
- **AND** both switch-off rollback combinations remain covered by the post-release verification obligations
