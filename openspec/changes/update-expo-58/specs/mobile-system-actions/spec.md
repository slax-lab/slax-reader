# Mobile System Actions

## Purpose

Let users save links and reopen eligible reading content through iOS system entry points while preserving account ownership, reliable recovery and metadata privacy.

## ADDED Requirements

### Requirement: Users can hand off a URL from Siri or Shortcuts

On supported iOS systems, Mobile SHALL expose a save-to-Slax-Reader action accepting an absolute HTTP(S) URL and optional title. It SHALL open the application for processing when needed. Invalid or credential-bearing URLs MUST be rejected. A system acknowledgement SHALL distinguish queued handoff from confirmed saving; failure or offline delay MUST NOT be reported as a completed save.

#### Scenario: Save runs while the application process is absent
- **WHEN** the user invokes save with a valid URL while JavaScript is not running
- **THEN** the invocation survives until application processing can begin
- **AND** the application reports actual save completion or a recoverable pending/error state

#### Scenario: Input is unsafe or the platform is unsupported
- **WHEN** a save URL has an unsupported scheme or embedded credentials, or system actions are unavailable
- **THEN** the input cannot trigger an authenticated save
- **AND** the ordinary application remains usable

### Requirement: Pending actions preserve ownership and tolerate replay

Pending actions SHALL be processed only with a verified active account/origin, admitted data and valid credentials. Actions SHALL retain ownership across restarts; an action without provable ownership SHALL require an explicit claim before saving. Delivery replay SHALL not create duplicate local processing, repeated donations or premature acknowledgement. The application SHALL retain retryable failures and expose permanent failure/discard outcomes. Account replacement SHALL cancel obsolete work and prevent it from executing for the replacement account.

#### Scenario: An invocation is delivered again after interruption
- **WHEN** the same invocation arrives more than once, including after saving but before acknowledgement
- **THEN** processing reconciles the completed operation and finishes acknowledgement safely
- **AND** it does not silently repeat an already completed user action

#### Scenario: Account changes before processing completes
- **WHEN** a user signs out or replaces the account/API origin with an action pending or in flight
- **THEN** the previous action cannot save or publish metadata under the new owner
- **AND** stale callbacks cannot update the replacement session

### Requirement: Spotlight and donations publish only eligible metadata under current settings

Per the explicit human approval on 2026-10-20, system indexing and donations SHALL default on for new or unset preferences. Each persisted explicit false preference SHALL remain disabled, and Settings SHALL permit independent opt-out. Default-enabled publication SHALL wait for loaded preferences, an authenticated admitted account and valid credentials; Login and unadmitted sessions SHALL NOT publish. When enabled, Mobile SHALL publish at most 100 recent successfully saved eligible unarchived, non-deleted bookmarks from the active account using opaque identifiers, display titles and source hosts. Bodies, notes, highlights, credentials and full URLs SHALL NOT enter the catalog. Content marked private or lacking required eligibility SHALL be excluded. Disabling integration, deleting content, signing out or replacing the owner SHALL revoke obsolete catalog entries and donations, retrying failures without exposing new-owner data. Donations SHALL follow successful user actions only.

#### Scenario: Default-enabled system discovery
- **WHEN** loaded preferences have no explicit opt-out and the authenticated account has admitted data and valid credentials
- **THEN** only the bounded eligible metadata appears in system discovery
- **AND** failed or merely queued saves do not create successful-action donations

#### Scenario: A stored opt-out survives startup
- **WHEN** either integration has a persisted false preference or preference loading is incomplete
- **THEN** startup cannot publish through that integration
- **AND** enabling the other integration does not overwrite that choice or the other integration preference

#### Scenario: A catalog entry becomes ineligible
- **WHEN** content is deleted, made private, or removed by opt-out/account replacement
- **THEN** Mobile requests removal of its system metadata and retries failed removal
- **AND** stale system results cannot authorize access to that content

### Requirement: System content opens through current session admission

Spotlight and intent content entry SHALL wait for current session and navigation readiness, resolve identifiers against the active account, and use ordinary Reader access rules. Invalid, deleted, private-to-another-owner or stale identifiers MUST NOT bypass admission.

#### Scenario: A stale result opens during cold startup
- **WHEN** the user opens an old system result before navigation or account data is ready
- **THEN** routing waits and revalidates the identifier under the current account
- **AND** unavailable content receives an ordinary recovery outcome without revealing another account's data

### Requirement: Each system capability uses its true minimum supported OS

Ordinary save/open intents, entity lookup and donation/revocation SHALL remain available at the effective Expo/project iOS 16.4 floor. Spotlight IndexedEntity publication SHALL require iOS 18 independently. The optional EnumerableEntityQuery conformance SHALL require iOS 17, and optional IndexedEntityQuery reindex callbacks SHALL remain isolated to iOS 27. A newer optional conformance SHALL NOT raise the minimum for ordinary intents or donation. Unsupported Spotlight publication SHALL be skipped while preserving the user's preference and reporting its requirement in Settings, without turning ordinary donation into a recurring failure.

#### Scenario: Donation remains available before Spotlight indexing
- **WHEN** an admitted iOS 16.4–17 session has loaded default-on preferences and valid credentials
- **THEN** successful user actions can be donated and revoked using the supported intent API
- **AND** unsupported Spotlight indexing is skipped without replacing an explicit opt-out or raising the ordinary intent floor
