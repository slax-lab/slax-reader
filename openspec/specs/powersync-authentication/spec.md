# powersync-authentication Specification

## Purpose
Define the lifetime and identity guarantees of credentials issued for authenticated PowerSync synchronization.

## Requirements

### Requirement: PowerSync credentials expire 24 hours minus one second after issuance

The system SHALL issue PowerSync JWTs with integer Unix-second `iat` and `exp` claims such that `exp - iat` equals 86,399, strictly below 24 hours. The token SHALL expire at `exp` and MUST NOT authorize synchronization at or after that timestamp. Issuance SHALL preserve the authenticated user's UUID as `sub`, the `reader-sync` audience, RS256 signing with the configured key identifier, and the existing `{ token, endpoint }` response. This policy SHALL NOT change the login token's lifetime.

#### Scenario: Authenticated credential issuance

- **WHEN** an active authenticated user requests PowerSync credentials
- **THEN** the signed token expires exactly 86,399 seconds after its issued-at timestamp
- **AND** its subject, audience, signing metadata, and returned endpoint preserve the existing contract

#### Scenario: Credential expiration boundary

- **WHEN** a correctly signed PowerSync token is validated immediately before its expiration
- **THEN** it is still valid
- **AND** validation at or after expiration rejects the token as expired

### Requirement: Mobile credential lifetime diagnostics match backend issuance

The mobile client SHALL expect a signed lifetime of 86,399 seconds when checking newly acquired PowerSync credentials for contract drift. It SHALL continue reporting different signed lifetimes without changing actual signed-expiry validation, the pre-expiry safety window, account/origin ownership, or the independent 24-hour cache ceiling.

#### Scenario: Expected issuance does not trigger a mismatch warning

- **WHEN** the mobile client acquires a valid token whose `exp - iat` is 86,399 seconds
- **THEN** it does not report a credential lifetime contract mismatch
- **AND** it uses that token's signed expiration for its SDK credentials

#### Scenario: A different issuance lifetime remains observable

- **WHEN** the mobile client acquires a valid token whose signed lifetime is 300 or 86,400 seconds
- **THEN** it reports the actual issued lifetime as a contract mismatch
- **AND** it continues respecting that token's signed expiration and account/origin ownership
