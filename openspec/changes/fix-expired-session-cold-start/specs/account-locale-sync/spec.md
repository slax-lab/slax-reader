# Spec Delta

## ADDED Requirements

### Requirement: Web locale startup tolerates rejected-session cleanup before rendering

Web SHALL complete existing rejected-session cleanup when it runs before the first component renders. Initializing locale state during that cleanup SHALL NOT require component setup or leave account state unusable. The first rendered page SHALL retain working language operations and follow existing login recovery without requiring the user to refresh. A fresh locale state SHALL start from the application's active language, while an existing persisted locale SHALL retain its current precedence.

#### Scenario: Locally expired login token during cold startup
- **WHEN** Web cold-starts with an expired login token, no initialized account state, and no reusable sync credentials
- **AND** synchronization detects the expired login token before the first component renders
- **THEN** existing session cleanup completes and the login recovery page can render on that visit
- **AND** subsequent language operations work without a locale-initialization or missing-method error
- **AND** the expired token is not sent to the sync-credentials endpoint

#### Scenario: Sync-credentials endpoint rejects the current session before rendering
- **WHEN** Web cold-starts with no initialized account state or reusable sync credentials
- **AND** the sync-credentials endpoint rejects the current login token with HTTP 401 before the first component renders
- **THEN** existing session cleanup completes and login recovery proceeds without a fatal startup page
- **AND** later page rendering can use language state and operations without refreshing

#### Scenario: Fresh startup uses the active application language
- **WHEN** account state is first initialized outside component setup and no locale has been persisted
- **THEN** its initial display language matches the active application language for both English and Chinese
- **AND** initialization does not implicitly save an account-language preference

#### Scenario: Persisted locale remains authoritative for display restoration
- **WHEN** account state is restored with a previously persisted supported locale that differs from the application's initial language
- **THEN** existing display restoration applies that persisted locale
- **AND** startup does not overwrite it or implicitly save it to the account
