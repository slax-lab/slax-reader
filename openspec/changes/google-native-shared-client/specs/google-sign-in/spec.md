# Spec Delta

## Purpose

Defines how the API accepts Google sign-in from the Web reader and the native iOS and Android apps, and which ID token checks every platform must pass.

## ADDED Requirements

### Requirement: Native Google sign-in accepts the shared server client

The API SHALL accept native (`ios` and `android`) Google sign-in requests whose ID token audience is that platform's configured Google client ID, including when that client ID is the same value as the Web Google client ID. The API MUST reject a native Google sign-in request with a configuration error when the platform has no configured Google client ID.

#### Scenario: Native token issued for the shared Web/server client

- **WHEN** an iOS or Android app submits a valid Google ID token whose `aud` is the shared client ID, and the platform's configured client ID equals the Web client ID
- **THEN** the sign-in passes verification and is not rejected as an invalid audience

#### Scenario: Native client ID is not configured

- **WHEN** a native platform's Google client ID is missing or empty
- **THEN** the request is rejected with `GOOGLE_SSO_AUD_ERROR` before any token verification

### Requirement: Google ID tokens are verified for every platform

The API SHALL verify every Google ID token's signature against Google's keys, its issuer, expiry, required claims, and verified email, and MUST require its `aud` to equal the requesting platform's configured client ID. For Web sign-in, a present `azp` MUST also equal the Web client ID.

#### Scenario: Token issued for another client

- **WHEN** any platform submits a Google ID token whose `aud` is not that platform's configured client ID
- **THEN** the sign-in is rejected

#### Scenario: Web token with a different authorized party

- **WHEN** a Web sign-in token has an `azp` that differs from the Web client ID
- **THEN** the sign-in is rejected
