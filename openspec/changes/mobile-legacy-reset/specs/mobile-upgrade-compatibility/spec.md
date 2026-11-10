# Spec Delta

## ADDED Requirements

### Requirement: Kotlin-origin installations reset local data once

On Android and iOS, a recognized old Kotlin installation SHALL discard its old local database and account caches once and create a new local database for cloud synchronization. The same policy SHALL cover previously adopted, failed and partially migrated Kotlin-origin storage. It MUST NOT attempt old database adoption, require its schema or contents to pass preservation checks, or require opening it before removal. Legacy unsynchronized changes and offline-only state SHALL be discarded intentionally; server records MUST NOT be deleted or receive replayed legacy changes.

#### Scenario: A normal old-app installation upgrades
- **WHEN** an old Kotlin installation launches the new application before its one-time reset has completed
- **THEN** its old database and account caches are discarded and a new database is created, regardless of whether the old database could have been migrated
- **AND** cloud-backed content returns through normal synchronization rather than old database adoption

#### Scenario: An earlier upgrade already failed or adopted the legacy file
- **WHEN** a Kotlin-origin installation contains an old accepted, opening or failed adoption state
- **THEN** the new reset replaces that old local storage without consulting its preservation outcome
- **AND** obsolete upgrade and cleanup state does not trap the user in an old migration error

#### Scenario: A recognized legacy database is unreadable
- **WHEN** the old database has an unsupported structure or unreadable contents but its app-owned files can be removed
- **THEN** reset completes without successfully opening or validating that database
- **AND** normal login and synchronization can proceed on new storage

#### Scenario: Reset is interrupted
- **WHEN** the process exits before local reset completes
- **THEN** the next launch finishes the same reset before account services can publish data or new writes
- **AND** interruption after reset completion does not discard data created afterward

#### Scenario: A normal Expo installation starts or upgrades
- **WHEN** an installation is native-created Expo storage or has already completed the one-time reset
- **THEN** its database, new pending operations and offline data are not reset
- **AND** a missing new marker, app-version change, network failure, expired credential or temporary file lock alone does not select destructive reset

#### Scenario: Cloud refill is offline
- **WHEN** reset completes without network access
- **THEN** the application presents normal login or a usable empty/loading authenticated shell with network retry
- **AND** it downloads cloud data after connectivity returns without resetting again

#### Scenario: A deletion target is outside the owned storage boundary
- **WHEN** any cleanup target or child directory is redirected away from its approved application storage slot
- **THEN** the application rejects the reset before creating a new reset marker or deleting any old/new database, cache or preference data
- **AND** repeated attempts preserve the same data until the unsafe path is corrected; a later safe attempt can complete normal reset

## MODIFIED Requirements

### Requirement: Legacy preferences and shared authentication are migrated safely

During one-time Kotlin reset, the application SHALL retain a usable current account and API environment when available, otherwise make a best-effort import of the old session and necessary identity preferences. Nonessential legacy settings and local reading state need not survive. Unreadable legacy preferences SHALL result in normal signed-out startup instead of blocking application initialization. Main-app and extension authentication MUST remain consistent; pending sign-out MUST win over both current and legacy credentials. Retired preference sources MUST NOT resurrect a previous session, and credentials MUST NOT appear in diagnostics.

#### Scenario: First launch is interrupted during preference migration
- **WHEN** the application exits before reset and minimal session import complete
- **THEN** the next launch resumes the same reset and account decision
- **AND** it does not restore an explicitly signed-out account or publish a partial identity

#### Scenario: Existing session is usable
- **WHEN** a current or readable legacy session identifies the account and API environment consistently and no sign-out is pending
- **THEN** the user keeps that local logged-in identity through reset
- **AND** existing credential checks still gate protected network access

#### Scenario: Legacy preferences are corrupt
- **WHEN** a selected legacy installation has unreadable identity preferences and no usable current identity
- **THEN** old local data is reset and ordinary provider login remains available
- **AND** lossless preference conversion is not a prerequisite to using the app

### Requirement: Pending offline transactions are retained across SDK changes

Ordinary updates of native-created or reset-completed Expo storage SHALL retain local data, pending operation order, transaction boundaries, identifiers and upload semantics. Concurrent competing synchronization owners for one file MUST NOT be opened. The explicit one-time Kotlin-origin reset is an exception: it SHALL discard old queued operations without preservation checks, conversion or upload. This exception MUST NOT apply to offline work created after the reset.

#### Scenario: Offline edits exist before upgrading
- **WHEN** a user upgrades with pending offline changes
- **THEN** a recognized unreset Kotlin installation discards those legacy changes with the old database, while ordinary native-created or reset-completed Expo storage retains its pending changes
- **AND** the Kotlin reset downloads cloud state without replaying discarded operations or deleting cloud records

#### Scenario: Offline edits exist after the reset
- **WHEN** a user creates offline changes in new storage and restarts or installs an ordinary Expo update
- **THEN** the changes remain pending and upload with normal ordering when connectivity returns
- **AND** the completed legacy reset does not run again

### Requirement: Cached content and reading metadata remain usable

Ordinary updates of native-created or reset-completed Expo storage SHALL retain existing cache and reading behavior. The one-time Kotlin reset SHALL discard legacy offline assets, cache metadata, local AI results and reading positions; cloud-backed records and content SHALL be reacquired using the normal sync and cache policy. Personal and collection content MUST remain account/owner-scoped. Ordinary cache cleanup MUST NOT erase new unsynchronized business operations.

#### Scenario: A cached collection article is opened offline after upgrade
- **WHEN** a user opens an article whose cache existed before upgrading
- **THEN** legacy cache discarded by Kotlin reset is unavailable until normal reacquisition, while an ordinary Expo upgrade retains its existing cache
- **AND** cloud content remains unchanged and subsequent access uses the correct owner identity

#### Scenario: A cached article was created after reset
- **WHEN** the application restarts or receives an ordinary Expo update
- **THEN** its normal cached content and reading state remain usable
- **AND** legacy reset does not remove them again

### Requirement: Account lifecycle prevents stale-user state

Startup SHALL present the route selected by local identity while credential refresh occurs. Sign-out, account switching and deletion SHALL isolate the correct prior-account state before another account accesses it. Stale unauthorized responses MUST NOT clear a newer valid session. During selected Kotlin reset, old database readiness MUST NOT be required to finish local sign-out or accept subsequent authentication after cleanup; historical upgrade and cleanup blockers SHALL be retired together. This does not permit cross-account access before reset completes.

#### Scenario: An old request fails after token refresh
- **WHEN** an old-token request receives an unauthorized response after a new token is stored
- **THEN** the current valid session remains intact
- **AND** account data retain their correct owner

#### Scenario: The active account changes
- **WHEN** the user signs out or switches account
- **THEN** prior-user data and synchronization are isolated before the new account accesses services
- **AND** cached content, comments and shared-extension credentials do not leak between users

#### Scenario: A rejected credential is replaced without deleting offline edits
- **WHEN** an active native-created or reset-completed account requires reauthentication
- **THEN** the existing provider flow accepts only that same account without deleting its new offline work
- **AND** another provider account cannot replace its scoped data through reauthentication

#### Scenario: Legacy migration failure left sign-out pending
- **WHEN** a selected Kotlin-origin installation contains pending sign-out from a failed old database cleanup
- **THEN** reset removes old local storage and completes sign-out without opening the old database
- **AND** the old bearer is not restored and successful subsequent provider/backend authentication is not rejected by the obsolete pending state

#### Scenario: Sign-out cleanup is interrupted
- **WHEN** sign-out fails or the process stops during cleanup
- **THEN** persisted sign-out intent prevents old protected requests, shares and credential restoration
- **AND** selected Kotlin reset completes that cleanup without opening the old database, while ordinary native-created or reset-completed storage retries normal cleanup without selecting legacy reset again

#### Scenario: Local identity cannot be restored
- **WHEN** old preference decoding fails before local identity can be published
- **THEN** the application completes the selected reset and presents ordinary login
- **AND** repeated startup does not retry the same lossless import or revive old credentials

### Requirement: Android storage admission tolerates equivalent application-root aliases

Android storage handling SHALL treat operating-system aliases of the same trusted application root as equivalent. Native-created and reset-completed storage SHALL reopen its normal slot without an alias-only failure. A selected one-time Kotlin reset SHALL remove only approved app-owned slots, independent of legacy binding/schema validity; previously adopted Kotlin storage is reset rather than preserved. Redirected child directories or paths outside approved roots MUST NOT be followed for opening or deletion. Outside the selected reset, missing or inconsistent established storage MUST NOT trigger arbitrary destructive replacement.

#### Scenario: A new installation starts through an application-root alias
- **WHEN** Android supplies a legitimate ancestor alias and the native slot does not exist
- **THEN** startup resolves and initializes the intended slot within the same application root
- **AND** equivalent path spellings do not cause recovery failure

#### Scenario: An established native database reopens through an application-root alias
- **WHEN** Android exposes a native-created or reset-completed database through a legitimate ancestor alias
- **THEN** startup reopens the same native slot
- **AND** its current data and pending operations remain intact

#### Scenario: A previously adopted legacy database reopens through an alias
- **WHEN** an unreset Kotlin-origin installation identifies a previously adopted legacy database and the application-root path spelling changes only through a legitimate operating-system alias
- **THEN** startup resolves that same legacy database through the alias and applies the bounded one-time reset instead of reopening it for use
- **AND** its legacy queued operations are discarded rather than preserved, and no fresh database is substituted at a different path

#### Scenario: An application child directory is redirected
- **WHEN** a designated files/database child points away from its approved slot
- **THEN** storage handling does not open, delete or initialize the redirected target
- **AND** it exposes a local recovery condition rather than bypassing containment

#### Scenario: An established database cannot be verified
- **WHEN** an established database is missing, its file is redirected, its stored owner or identity does not match, or the normal native database cannot be opened because of a real I/O or SQLite initialization error
- **THEN** startup exposes the existing recovery or retry behavior without deleting the original remaining files or creating an empty replacement
- **AND** alias compatibility does not authorize bypassing verification; obsolete adoption/installation records are not consulted, and an absent normal database can be initialized at its fixed owned slot without selecting Kotlin reset

#### Scenario: A development-fresh startup uses the same application-root alias
- **WHEN** explicit development-fresh mode starts through a legitimate ancestor alias
- **THEN** it resolves the expected native slot
- **AND** development mode does not become a fallback for production reset or ownership failures
