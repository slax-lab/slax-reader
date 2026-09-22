# Spec Delta

## Purpose

Defines how Web authentication providers and Turnstile protection behave when contributors configure only the services they have available.

## ADDED Requirements

### Requirement: Google OAuth configuration is required

The Web application SHALL require `GOOGLE_OAUTH_CLIENT_ID` to be declared with a non-empty value before a frontend environment is considered ready. Preflight SHALL report a missing or empty value as a blocking error and SHALL identify how to create the client configuration.

#### Scenario: Google client ID is missing

- **WHEN** a Web environment has no `GOOGLE_OAUTH_CLIENT_ID`
- **THEN** `pnpm preflight --app web` reports `GOOGLE_OAUTH_CLIENT_ID` as `（必填）`
- **AND** the report exits with a non-zero status

#### Scenario: Google client ID is configured

- **WHEN** a Web environment has a non-empty `GOOGLE_OAUTH_CLIENT_ID`
- **THEN** the Google login control can construct its authorization request
- **AND** preflight reports the variable as configured without printing its value

### Requirement: Apple OAuth is optional

The Web application SHALL treat `APPLE_OAUTH_CLIENT_ID` as an optional provider. When the value is absent or empty, all Web Apple login controls SHALL be hidden while Google login remains available. When the value is configured, Apple login SHALL remain available.

#### Scenario: Apple OAuth is disabled

- **WHEN** `APPLE_OAUTH_CLIENT_ID` is absent or empty
- **THEN** the login page and login modal do not render an Apple login control
- **AND** preflight reports the variable as optional without blocking the frontend check

#### Scenario: Apple OAuth is enabled

- **WHEN** `APPLE_OAUTH_CLIENT_ID` contains a non-empty value
- **THEN** the login page and login modal render the Apple login control
- **AND** selecting it starts the existing Apple authorization flow

### Requirement: Turnstile protection is optional

The Web application SHALL treat `TURNSTILE_SITE_KEY` as an optional protection feature. When the value is absent or empty, the invitation login, promotion receive, and payment flows SHALL omit their Turnstile widgets and continue to the existing downstream request or payment setup without waiting for a Turnstile token. When the value is configured, the existing widget and token gating behavior SHALL remain enabled.

#### Scenario: Turnstile is disabled

- **WHEN** `TURNSTILE_SITE_KEY` is absent or empty
- **THEN** invitation login does not require a Turnstile token before showing login actions
- **AND** promotion receive and payment setup proceed without waiting for a Turnstile token
- **AND** preflight reports the variable as optional without blocking the frontend check

#### Scenario: Turnstile is enabled

- **WHEN** `TURNSTILE_SITE_KEY` contains a non-empty value
- **THEN** the affected flows render Turnstile widgets
- **AND** promotion, invitation login, and payment setup retain their existing token checks

### Requirement: Configuration guidance distinguishes provider states

The Web environment example and Web development documentation SHALL explain that Google OAuth is required, Apple OAuth and Turnstile are optional, and the Google OAuth section SHALL describe the steps for creating a Web OAuth client ID without requesting a client secret for frontend configuration.

#### Scenario: Contributor follows the Web setup guide

- **WHEN** a contributor opens the Web environment example or development guide
- **THEN** they can identify the required Google variable and the optional Apple and Turnstile variables
- **AND** they can find the Google Cloud Console steps and redirect URI shape needed to create the client ID
