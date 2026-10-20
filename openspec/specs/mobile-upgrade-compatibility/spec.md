# mobile-upgrade-compatibility Specification

## Purpose
Allow existing mobile installations to upgrade to the Expo application without losing authentication, unsynchronized changes, offline content, or account isolation.

## Requirements

### Requirement: Existing installation and extension identities are preserved

The migration SHALL retain Android identity `com.slax.reader`, iOS identity `app.slax.reader`, iOS extension identity `app.slax.reader.share`, and App Group `group.app.slax.reader`. Native configuration SHALL preserve required callback/entitlement relationships and permit authorized same-signature upgrades with monotonically increasing versions. App-store publication remains a separately authorized operation.

#### Scenario: An existing installation is upgraded
- **WHEN** the migrated build is installed over the original app with the appropriate signing identity
- **THEN** it updates that installation rather than creating a separate app
- **AND** its extension and shared container retain the original relationships

### Requirement: Legacy preferences and shared authentication are migrated safely

Existing authentication, user identity, token refresh state, language, cache settings, reading preferences, selected environment, continue-reading context, and stable analytics identity SHALL survive migration from legacy preference storage. Main-app and extension authentication SHALL remain consistent. Migration SHALL be idempotent and recoverable after interruption; failure MUST NOT erase the only original copy or expose credentials through diagnostics.

#### Scenario: First launch is interrupted during preference migration
- **WHEN** the migrated app exits before migration completes
- **THEN** the next launch resumes or safely retries
- **AND** the original session and preferences remain recoverable

### Requirement: Pending offline transactions are retained across SDK changes

The migration SHALL preserve existing local database data and pending operation order, transaction boundaries, identifiers, and upload semantics. It MUST NOT rebuild the database by discarding queued operations or open concurrent competing synchronization owners for the same file. Switching database implementations SHALL require evidence that their on-disk state can be adopted or a lossless migration path.

#### Scenario: Offline edits exist before upgrading
- **WHEN** a user edits bookmarks, tags, or marks offline and upgrades while still offline
- **THEN** those changes remain visible and pending in the migrated app
- **AND** reconnecting uploads them without missing or duplicate logical operations

### Requirement: Synchronization preserves retries and rejection handling

Synchronization SHALL preserve credential refresh, schema/protocol parameters, previous-value metadata differences, ordered batched uploads, atomic transaction completion, and existing rejection isolation. Retryable network/server failures SHALL retain operations for retry; malformed transactions SHALL follow the source's isolated HTTP 400 handling without discarding adjacent valid transactions.

#### Scenario: One transaction causes an upload rejection
- **WHEN** a batch receives the source's malformed-request rejection
- **THEN** transactions are isolated with the existing behavior
- **AND** valid neighboring transactions can complete while retryable failures remain pending

### Requirement: Cached content and reading metadata remain usable

Cached HTML/images, manual/automatic cache status, mark profiles, AI results, article/outline positions, and cache limits SHALL survive migration. Personal and collection content SHALL retain distinct owner-aware cache keys. Cache cleanup SHALL not erase unsynchronized business operations.

#### Scenario: A cached collection article is opened offline after upgrade
- **WHEN** its owner-aware cache and reading state existed before upgrading
- **THEN** the correct article and resources are served offline
- **AND** its positions and permissions are not confused with a personal bookmark having a similar identifier

### Requirement: Account lifecycle prevents stale-user state

Startup SHALL preserve source rendering from persisted authenticated state while refresh occurs. Sign-out, account switching, deletion, and concurrent authentication failures SHALL clear or disconnect the correct account state before another account renders. A stale response for a prior token MUST NOT clear a newer valid session.

#### Scenario: An old request fails after token refresh
- **WHEN** an authenticated request using the prior token receives an unauthorized response after a new token is stored
- **THEN** the current valid session remains intact
- **AND** synchronization and account data retain their correct owner

#### Scenario: The active account changes
- **WHEN** the user signs out or switches account
- **THEN** prior-user data and synchronization are isolated before rendering the new account
- **AND** cached content, comments, and shared-extension credentials do not leak between users

#### Scenario: A rejected credential is replaced without deleting offline edits
- **WHEN** the active account requires reauthentication
- **THEN** the user can reopen the existing provider login from the authenticated shell while keeping admitted cached data and pending writes
- **AND** only that same account can complete reauthentication; selecting another provider account leaves the original session and offline edits unchanged

#### Scenario: Sign-out cleanup is interrupted
- **WHEN** account cleanup fails or the process stops after sign-out begins
- **THEN** persisted sign-out intent prevents protected requests, incoming shares and restoration of the old credentials as a usable session
- **AND** localized recovery allows cleanup to finish before another account enters

#### Scenario: Local identity cannot be restored
- **WHEN** preference migration or reading fails before local session publication
- **THEN** the application presents localized recovery with a retry action rather than an indefinite blank startup surface
- **AND** retries preserve migration data and share one runtime restart

### Requirement: Main API credentials refresh on a daily foreground lifecycle

The main API JWT SHALL be refreshed when 86,400 seconds have elapsed since the last successful refresh, checked at startup, foreground return and before authenticated request or sync-credential use. Cold startup SHALL select and immediately present Login or the authenticated shell after reading local logged-in state, without waiting for refresh, sync or initialization. Protected requests SHALL await due main refresh and asynchronous PowerSync connection SHALL await valid scoped credentials; these network gates MUST NOT block local route presentation or be bypassed by it. Cached data SHALL hydrate only after genuine ownership/migration verification, with localized loading/failure inside the shell rather than global blank UI or unverified cross-account access. An active foreground deadline SHALL cover continuous use without restart; background SHALL cancel scheduling and foreground SHALL re-evaluate due state, without an OS background service. Concurrent triggers SHALL share one account/API-origin-owned refresh. Only successful refresh SHALL advance its persisted timestamp; failures SHALL use bounded retry/backoff without resetting account/local data or logging tokens. Known expired credentials MUST NOT be treated as valid. Any definitive authentication transition SHALL match the current token/generation; stale failures or 401 responses MUST NOT clear a newer session.

#### Scenario: A cold process starts with stale persisted credentials
- **WHEN** real runtime startup restores a main session last refreshed two days ago and expired PowerSync credentials while main refresh is deferred
- **THEN** the locally chosen route/shell appears before deferred refresh or initialization resolves, while protected API/PDF/sync requests remain behind network readiness
- **AND** cached data appears only after ownership/migration checks; successful main refresh precedes valid sync acquisition/connection without a stale-bearer dispatch

#### Scenario: Database admission fails after the shell is presented
- **WHEN** local identity is known but asynchronous database ownership/migration admission is pending or fails
- **THEN** the shell remains visible with localized data loading or upgrade failure
- **AND** no unverified or previous-account data is accessed, and late initializer results cannot publish after stop or account/origin replacement

#### Scenario: Cold-start refresh cannot reach the network
- **WHEN** the awaited startup refresh fails from offline or transient network conditions
- **THEN** safe cached local UI and queued writes remain intact while protected network work stays blocked or bounded-retryable
- **AND** neither detached ignored refresh nor fabricated authentication permits stale requests; definitive current-token rejection may require reauthentication without destructive local-data reset

#### Scenario: The daily deadline occurs during continuous foreground use
- **WHEN** the last successful main refresh reaches the 86,400-second boundary while API and sync work also request credentials
- **THEN** one refresh serves the concurrent callers and the next deadline follows its successful completion
- **AND** failed attempts neither advance the success timestamp nor cause an unbounded request-driven retry loop

#### Scenario: The app resumes after a refresh deadline
- **WHEN** the application returns after backgrounding past the daily deadline
- **THEN** it rechecks and refreshes before due authenticated request/sync use without requiring a restart
- **AND** offline or timeout failure preserves local data, queued writes and account context while exposing bounded recovery rather than a destructive reset

#### Scenario: Account or origin changes while refresh is pending
- **WHEN** a refresh response or old-token 401 arrives after token rotation, sign-out, account replacement or API-origin change
- **THEN** obsolete success/failure cannot mutate the new session or reactivate its old timers
- **AND** no previous-account token is returned to the new request or synchronization scope

### Requirement: PowerSync credential caching follows actual signed expiry

The client SHALL cache the server-issued PowerSync JWT according to its actual finite `exp`, scoped to account/session generation and configured API origin. It SHALL honor the server's actual lifetime, including the observed 300-second issuance, rather than assume a 24-hour contract. It SHALL refresh automatically within a documented pre-expiry safety window appropriate to that lifetime, share concurrent acquisition, and return `expiresAt` using the installed SDK's exact supported type and semantics. Invalid, missing or expired expiry MUST NOT enter a reusable cache; the client MUST NOT extend validity with an arbitrary fixed cache duration or treat decoded claims as signature verification. Due main API refresh SHALL precede sync-token acquisition without recursion. The PowerSync UUID subject and main API encoded ID SHALL be treated as distinct wire representations, without replacing account/origin ownership checks with raw-string equality. Rejection, expiry or scope change SHALL invalidate the relevant lease and use supported SDK credential renewal/reconnection while preserving one database owner and pending CRUD.

#### Scenario: A cached sync token reaches its safety window
- **WHEN** a current account/origin's cached JWT approaches its actual expiration
- **THEN** the connector and SDK coordinate one fresh credential acquisition and expose the returned expiry to the SDK
- **AND** the client neither reuses an expired token nor fabricates another 24 hours of validity

#### Scenario: The server issues a five-minute sync credential
- **WHEN** an authorized response issues a valid 300-second JWT with a UUID subject distinct from the main API encoded ID
- **THEN** the client honors its actual expiry and appropriate safety window within the active account/origin scope
- **AND** neither the shorter lifetime nor the different wire identifier alone is treated as an invalid credential or permission to extend signed validity

#### Scenario: Issued expiry is invalid
- **WHEN** the server credential has missing, malformed or already-expired expiry
- **THEN** it is not reused and the invalid expiry is reported without changing signed validity
- **AND** bounded recovery preserves local data and queued writes

#### Scenario: Sync credentials are renewed during pending uploads
- **WHEN** credentials expire or are rejected while local CRUD remains queued
- **THEN** supported renewal/reconnection retains transaction order and the same legitimate database owner
- **AND** old-generation credential responses cannot repopulate a replaced account/origin cache or discard uploads
