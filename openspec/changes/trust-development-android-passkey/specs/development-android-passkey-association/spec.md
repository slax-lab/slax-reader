# Development Android Passkey association

## Purpose

Allow explicitly authorized locally signed Android test builds to use development Passkeys while preserving Play-only certificate trust on every other Web deployment.

## ADDED Requirements

### Requirement: Local Android certificate trust is preview-only

The preview Web deployment at `r.slax.dev` SHALL add the explicitly approved test APK signing certificate to its existing Android credential-sharing association. Local development, beta and production SHALL retain only the existing Play certificate.

#### Scenario: Android retrieves development association

- **WHEN** Android requests `https://r.slax.dev/.well-known/assetlinks.json` after deployment
- **THEN** the HTTP 200 JSON permits `com.slax.reader` credential sharing for the Play certificate and the actual approved local test certificate
- **AND** it grants no URL-handling permission and exposes no private key

#### Scenario: Another environment is built

- **WHEN** local development, beta or production Web assets are built
- **THEN** their Android association contains only the existing Play certificate
- **AND** the local test certificate is absent

#### Scenario: Apple or rollout behavior is inspected

- **WHEN** the development Android association is published
- **THEN** the existing Apple association and client rollout behavior remain unchanged
