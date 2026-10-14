# Mobile Upgrade Compatibility Spec Delta

## Purpose

Allow existing mobile installations to upgrade to the Expo application without losing authentication, unsynchronized changes, offline content, or account isolation.

## ADDED Requirements

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
