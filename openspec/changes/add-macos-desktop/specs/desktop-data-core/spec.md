# Spec Delta

## Purpose

Define the desktop data authority, account boundaries and typed publication contract so presentation can operate without network, SQL or credential privileges.

## ADDED Requirements

### Requirement: Core owns network storage and credentials

All application network requests, database access, file-cache operations and credential storage SHALL execute in the native core. Presentation SHALL use only a typed application IPC interface. Browser content policies SHALL deny direct external connections and remote script/font dependencies. Session credentials and pending login secrets SHALL remain outside JavaScript and be stored through Rust-owned, environment/origin-scoped local files with 0700 directory and atomic 0600 file permissions. The application SHALL not request system Keychain access.

#### Scenario: Presentation attempts direct network

- **WHEN** shell or article JavaScript attempts an external request or socket connection
- **THEN** the request is denied and no application credential is exposed

#### Scenario: Local credential path

- **WHEN** a release app saves a session or pending verifier
- **THEN** the restricted local credential store is used without a system Keychain prompt or exposing secrets to presentation

### Requirement: Account scoped runtime ownership

Database, cache, watchers, streams, requests and resource handles SHALL be bound to canonical API origin, stable account identity and runtime generation. Replacing that identity SHALL cancel prior work and reject both late success and late failure results. Local data SHALL not become visible until its ownership and admission checks pass.

#### Scenario: Account replacement during request

- **WHEN** a response for account A arrives after account B becomes active
- **THEN** the response cannot publish, write credentials, mutate a database or populate account B caches

#### Scenario: Offline cold start

- **WHEN** an admitted account has cached content but no network
- **THEN** the shell and safe local data are available without a global network readiness barrier

### Requirement: Typed command authorization

The IPC contract SHALL validate command inputs, sizes, identifiers and active ownership in the core, return stable typed errors and expose no arbitrary SQL, filesystem, network destination or credential operations. Commands SHALL be limited to authorized application webviews; saved article frames SHALL have no IPC capability.

#### Scenario: Forged frame command

- **WHEN** a saved-content frame tries to invoke a native command
- **THEN** the command is denied without relying solely on a hidden JS symbol

#### Scenario: Malformed mutation

- **WHEN** a caller supplies an invalid mark payload or another account document handle
- **THEN** the core rejects it before side effects

### Requirement: Cancellable latest value subscriptions

Query subscriptions SHALL return a unique watch identifier, publish an initial snapshot, coalesce bursts into bounded latest-value delivery and suppress unchanged snapshots. Explicit unsubscribe, channel failure, webview destruction, account retirement and shutdown SHALL release their work. Rebinding after a hidden window reopens SHALL yield a fresh snapshot.

#### Scenario: Rapid repeated updates

- **WHEN** a subscribed query changes repeatedly within a publication interval
- **THEN** the consumer receives the newest snapshot without duplicate identical deliveries or an unbounded queue

#### Scenario: Retired subscription

- **WHEN** a watcher is cancelled or its account is replaced
- **THEN** no later callback can affect UI or retain an active query for the retired owner

### Requirement: Existing synchronization integration

The desktop application SHALL consume the user-provided working synchronization integration without reopening its remediation or standalone validation work. It SHALL preserve existing stream/data formats, actual credential-expiry handling and bookmark-scoped comment retention. New desktop upload logic SHALL preserve transaction order and metadata/share semantics and SHALL retain failed and later transactions for retryable network, authentication, throttling and server failures.

#### Scenario: Retryable upload failure

- **WHEN** a desktop upload receives a retryable failure
- **THEN** failed and following queued transactions remain pending in order

#### Scenario: Existing integration dependency

- **WHEN** desktop wiring is configured
- **THEN** it pins the working integration revision and does not create a replacement protocol, SDK fork or proof A task

### Requirement: Library and synchronization state

The library SHALL expose Inbox, Starred and Archive with add URL, star/unstar, archive/unarchive, rename and delete operations through the core. Mutations SHALL remain account scoped and use the existing data contracts. The UI SHALL distinguish local data readiness, offline state, pending writes, synchronization progress and actionable failures.

#### Scenario: Offline mutation

- **WHEN** an authenticated admitted account stars or renames a cached bookmark while offline
- **THEN** the local library reflects the change and queues the mutation for later upload

#### Scenario: Stream not ready

- **WHEN** the library is visible but required synchronized data is still loading
- **THEN** the UI reports that readiness without representing a network connection as completed synchronization

### Requirement: Safe sign out

Signing out SHALL inspect pending writes and require an explicit discard decision before deleting unsent account changes. After sign-out is accepted, the core SHALL retire requests, watchers, reader capabilities and storage owners before clearing credentials and that account directory.

#### Scenario: Pending writes on sign out

- **WHEN** the user signs out with unsent local changes and cancels the discard action
- **THEN** the account and queued writes remain available

#### Scenario: Late write after sign out

- **WHEN** a retired task completes after accepted sign-out
- **THEN** it cannot recreate deleted account files or restore credentials

### Requirement: Explicit local and cloud search

Search SHALL query admitted SQLite locally by default. Only Search more SHALL initiate cloud search through Rust. Starting cloud search SHALL immediately remove local results and show a waiting state. Query, route and account changes SHALL cancel or reject stale results.

#### Scenario: Local query

- **WHEN** the user enters a search term
- **THEN** the application queries local SQLite without requesting cloud search

#### Scenario: Search more

- **WHEN** the user selects Search more
- **THEN** existing results disappear immediately and only the still-current cloud response is published after the waiting state

### Requirement: Visible and composable tag filters

Bookmark details SHALL display the bookmark's existing named tags. The persistent sidebar and the search surface SHALL support selecting and removing tag filters, including multiple tags with intersection semantics. Keyword and tag conditions SHALL be applied together in parameterized native SQLite queries; explicit cloud search SHALL retain the selected tag intersection before publishing results. Filter changes SHALL reject stale search results.

#### Scenario: Filter from the sidebar

- **WHEN** the user selects one or more tags from the sidebar
- **THEN** the middle library list contains bookmarks assigned every selected tag, with removable filter chips

#### Scenario: Search with tags

- **WHEN** the user enters a keyword with selected tags and later clicks Search more
- **THEN** the local and cloud result sets both retain those tag conditions and the active filters remain visible

#### Scenario: Bookmark detail tags

- **WHEN** a bookmark with assigned tags is selected
- **THEN** its named tags are visible in the detail surface and can be edited through the existing tag action
