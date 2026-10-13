# Spec Delta

## Purpose

Defines how the API accepts Google sign-in from the Web reader and the native iOS and Android apps, and which ID token checks every platform must pass.

## ADDED Requirements

### Requirement: Native Google sign-in verifies the server audience and the app presenter

The API SHALL accept a native (`ios` or `android`) Google ID token only when its `aud` is the Web/server Google client ID and its `azp` is one of the Google app client IDs configured for that platform. Each native platform MAY configure several app client IDs (for example one per Android signing certificate). The API MUST reject a native Google sign-in request with `GOOGLE_SSO_AUD_ERROR`, before any token verification, when the server client ID is missing, when the platform has no configured app client ID, or when the platform's app client IDs include the server client ID.

#### Scenario: Native token from a configured app client

- **WHEN** an iOS or Android app submits a valid Google ID token whose `aud` is the server client ID and whose `azp` is one of that platform's app client IDs
- **THEN** the sign-in passes verification

#### Scenario: Native token presented by another client

- **WHEN** a native token's `azp` is absent, belongs to the other native platform, is the server client, or is not configured
- **THEN** the sign-in is rejected

#### Scenario: Native platform misconfigured

- **WHEN** a native platform has no app client ID, or its app client IDs include the server client ID
- **THEN** the request is rejected with `GOOGLE_SSO_AUD_ERROR` before any token verification

### Requirement: Google ID tokens are verified for every platform

The API SHALL verify every Google ID token's signature against Google's keys, its issuer, expiry, required claims, and verified email, and MUST require its `aud` to equal the Web/server Google client ID. For Web sign-in, a present `azp` MUST also equal the Web client ID.

#### Scenario: Token issued for another client

- **WHEN** any platform submits a Google ID token whose `aud` is not the server client ID
- **THEN** the sign-in is rejected

#### Scenario: Web token with a different authorized party

- **WHEN** a Web sign-in token has an `azp` that differs from the Web client ID
- **THEN** the sign-in is rejected
