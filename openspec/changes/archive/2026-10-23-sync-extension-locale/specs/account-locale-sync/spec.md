# Spec Delta

## Purpose

Keep the Extension interface aligned with the user's saved Web account language while preserving active work and isolating language state between account sessions.

## ADDED Requirements

### Requirement: Account preference determines the Extension interface language

The Extension SHALL use the authenticated account's supported `en` or `zh` preference from the existing account API. It SHALL reuse only a cache belonging to the current account and otherwise fall back to a supported browser language, then English. Unsupported account preferences SHALL NOT overwrite a valid cache.

#### Scenario: Account and browser languages differ
- **WHEN** a signed-in account prefers Chinese and the browser uses English
- **THEN** Extension-owned interface text and context menus use Chinese after account preference retrieval
- **AND** request locale headers reflect the effective interface language

#### Scenario: Offline startup for the same account
- **WHEN** the Extension starts offline with a valid cache for the authenticated account
- **THEN** it uses the cached language without waiting for a network response

#### Scenario: No usable account preference
- **WHEN** no account preference or valid account cache is available
- **THEN** English browser variants map to English, simplified-Chinese browser variants map to Chinese, and unsupported variants fall back to English

### Requirement: Successful Web saves trigger safe refresh

Web SHALL notify the Extension once after the server confirms a language save. The notification SHALL carry only a versioned invalidation signal, not credentials or an authoritative language value. The Extension SHALL validate the configured Web origin, message source, top-level frame, and supported protocol before re-reading the preference from the authenticated account API. A failed save SHALL NOT announce success or change the Extension preference.

#### Scenario: Successful change in the same browser
- **WHEN** the user successfully saves a different Web language with an active Extension installed
- **THEN** the Extension re-reads the account language and updates open interfaces without requiring them to reopen
- **AND** under normal network conditions the visible update targets completion within two seconds of save confirmation

#### Scenario: Untrusted or incompatible notification
- **WHEN** a notification comes from an unrelated website, a child frame, an unexpected source, or an unsupported version
- **THEN** it cannot trigger an account preference update

#### Scenario: Failed save or absent Extension
- **WHEN** the server rejects a language save
- **THEN** Web retains the previous confirmed preference and emits no successful-save notification
- **AND** absence of the Extension does not prevent an otherwise successful Web save

### Requirement: Language state is isolated between account sessions

Logout or account change SHALL invalidate old cached language and in-flight results before a new account preference is applied. Same-account token rotation SHALL preserve the effective preference. A response or authorization failure for an obsolete token SHALL NOT overwrite or clear a newer session.

#### Scenario: Account switch during a request
- **WHEN** account A's preference request completes after the user switches to account B
- **THEN** A's language is discarded and B uses its own verified preference or browser fallback

#### Scenario: Stale authorization failure
- **WHEN** a request made with an old token returns 401 after the current token has changed
- **THEN** the current session and its locale remain intact
- **AND** a 401 for the current token retains the normal session-expiry behavior

### Requirement: Web language operations converge to the latest valid choice

Web SHALL serialize language saves, retain server-confirmed language independently of offline display fallback, and prevent older reads or translation loads from overriding the latest valid choice. Opening settings SHALL NOT save a language implicitly. Token refresh failure SHALL NOT undo a confirmed save or permanently block subsequent saves.

#### Scenario: Rapid selection with token rotation
- **WHEN** the user selects Chinese and then English while the first save rotates the same account's token
- **THEN** both authorized saves complete in order using the appropriate current token
- **AND** the final display and confirmed preference converge to English

#### Scenario: Stale local profile after saving
- **WHEN** a Web save succeeds and a later network failure falls back to an older local profile for the same account
- **THEN** the local profile does not replace the confirmed language

#### Scenario: Delayed display or refresh failure
- **WHEN** the server confirms a save but local translation application or auxiliary token refresh fails
- **THEN** the confirmed preference and one successful-save notification are retained
- **AND** any display failure is distinguished from a server save failure
- **AND** obsolete refresh results cannot overwrite a newer token

### Requirement: Open Extension interfaces react without losing user work

Extension-owned labels, placeholders, collection progress, menu titles, and AI operation status text SHALL react to language changes without remounting active interfaces or resetting their state. Translation SHALL retain positional placeholder behavior and English/key fallback. Article content, comments, generated AI content, and independent `ai_lang` SHALL remain unchanged.

#### Scenario: Switch during collection, comments, and chat
- **WHEN** the account language changes while collection or AI work is in progress and a comment draft is present
- **THEN** local interface text updates while the operation continues
- **AND** draft text, focus, selection, and operation status are preserved
- **AND** translated AI operation status retains its search query or visit subject

#### Scenario: Translation boundary
- **WHEN** Extension UI language changes
- **THEN** existing article and user-generated text remain unchanged
- **AND** third-party document language and Chrome-owned interface language are not modified

### Requirement: Locale synchronization recovers across lifecycle changes

The Extension SHALL reconcile preferences during startup, session changes, UI opening, restored connectivity, restored visibility, and the existing periodic calibration cycle. Synchronization SHALL be independent of bookmark or PowerSync readiness, merge repeated triggers, bound requests, and reject obsolete snapshots. Worker startup SHALL restore a missing 15-minute calibration alarm without resetting an existing alarm.

#### Scenario: Missed notification or another device
- **WHEN** the preference changes without a notification reaching this Extension
- **THEN** a subsequent lifecycle or calibration trigger reconciles it with the server

#### Scenario: Worker restart or lost cache
- **WHEN** a worker restarts after its locale cache is missing or invalid while content scripts remain open
- **THEN** live interfaces accept the new valid snapshot generation and recover
- **AND** delayed responses from an obsolete generation do not restore stale language

#### Scenario: Bookmark bridge unavailable
- **WHEN** bookmark synchronization is unavailable but the authenticated account API is reachable
- **THEN** language synchronization can still complete

### Requirement: Account locale requests obey the existing API envelope

Web and Extension SHALL accept successful account responses using the backend's `code: 200`, `message`, and endpoint-specific `data` payload. HTTP failures, business errors, and malformed payloads SHALL NOT be interpreted as successful saves, profile reads, or token refreshes.

#### Scenario: Existing backend responses
- **WHEN** the backend returns `code: 200` and valid profile, setting confirmation, or refreshed-token data
- **THEN** the corresponding locale operation succeeds without requiring a JSON `status` field

#### Scenario: Plausible data in an error response
- **WHEN** an HTTP or business error includes otherwise plausible account data
- **THEN** the operation fails and does not confirm a new preference or session
