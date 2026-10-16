# Spec Delta

## Purpose

Define the lifetime and identity guarantees of credentials issued for authenticated PowerSync synchronization.

## ADDED Requirements

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
