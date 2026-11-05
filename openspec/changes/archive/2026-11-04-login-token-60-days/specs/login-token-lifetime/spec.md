# Spec Delta

## Purpose

Define the configured lifetime of Reader login JWTs while preserving signed expiry enforcement and the existing session renewal mechanism.

## ADDED Requirements

### Requirement: Login tokens support the configured 60-day lifetime

The public API configuration template SHALL set `JWT_EXPIRES` to `5184000` seconds. Login and existing renewal SHALL issue JWTs using the selected environment's configured lifetime; with this value, `exp - iat` SHALL equal 5,184,000 seconds. Deployment SHALL continue using its selected private configuration as the authoritative runtime source. No independent refreshToken or new renewal endpoint SHALL be introduced.

#### Scenario: New login or renewal uses updated configuration

- **WHEN** login or existing renewal signs a token with `JWT_EXPIRES` set to `5184000`
- **THEN** the token's signed lifetime is exactly 60 days
- **AND** existing identity, issuer, audience and signature requirements remain enforced

### Requirement: Token expiry remains bound to signed claims

Changing configuration SHALL NOT extend an already issued JWT. Verification SHALL continue rejecting a token at or after its signed `exp`, even when a browser cookie persists longer.

#### Scenario: Existing token was issued for 30 days

- **WHEN** a previously issued 30-day token is verified after its signed expiration under the updated configuration
- **THEN** verification rejects it until the user authenticates again

#### Scenario: New token reaches its 60-day expiry

- **WHEN** a new 60-day token is verified immediately before its signed expiration
- **THEN** verification accepts it if its other claims and signature are valid
- **AND** verification rejects it at and after expiration
