# Native email-link website association

## Purpose

Allow the established iOS and Android App identities to receive website email-login links while preserving their existing Passkey credential associations.

## ADDED Requirements

### Requirement: Websites publish native email-link associations

The Web deployment SHALL publish Apple and Android URL association in its existing public well-known JSON documents on preview `r.slax.dev`, beta `r-beta.slax.com`, and production `r.slax.com` when the normal release reaches each environment. Both documents SHALL remain anonymously retrievable as HTTP 200 JSON without redirects.

#### Scenario: Apple retrieves the association document

- **WHEN** a platform retrieves `/.well-known/apple-app-site-association`
- **THEN** `applinks.details` authorizes `8G3A932HJG.app.slax.reader` for the exact `/email-login` path
- **AND** the existing `webcredentials.apps` remains unchanged
- **AND** `/email-login-web` is not authorized as an App Link path

#### Scenario: Android retrieves the association document

- **WHEN** a platform retrieves `/.well-known/assetlinks.json`
- **THEN** the established `com.slax.reader` target declares both `delegate_permission/common.get_login_creds` and `delegate_permission/common.handle_all_urls`
- **AND** its existing SHA-256 certificate list remains unchanged and no additional App identity is trusted

### Requirement: Association publication is independent of feature delivery

Publishing the documents SHALL preserve existing credential-sharing entries and SHALL NOT itself install native handlers or enable an email-link login endpoint.

#### Scenario: Only website association is released

- **WHEN** the support release publishes the association files before the email-link feature
- **THEN** existing login and Passkey behavior remain available
- **AND** email-link authentication and compatible native binaries still require their separate feature delivery
