# Native Passkey website association

## ADDED Requirements

### Requirement: Platforms retrieve public credential association documents

The Web deployment SHALL provide Apple application association and Android Digital Asset Links documents at their standard well-known paths on development `r.slax.dev`, beta `r-beta.slax.com` and production `r.slax.com`.

#### Scenario: A platform requests the Apple document

- **WHEN** a platform requests `/.well-known/apple-app-site-association` after deployment
- **THEN** the response is HTTP 200 JSON without authentication or a redirect
- **AND** `webcredentials.apps` contains `8G3A932HJG.app.slax.reader`

#### Scenario: A platform requests the Android document

- **WHEN** a platform requests `/.well-known/assetlinks.json` after deployment
- **THEN** the response is HTTP 200 JSON without authentication or a redirect
- **AND** it declares credential sharing for `com.slax.reader` and the confirmed SHA-256 `A1:05:FB:8C:2E:15:45:C7:B8:A5:C4:73:E5:29:15:EF:26:21:65:17:D2:95:14:62:D4:7E:0F:66:1D:A9:11:AA`
- **AND** it does not declare URL-handling permission or expose private signing material

#### Scenario: Association files are published independently

- **WHEN** an environment receives the association documents
- **THEN** existing login, native-feature rollout controls and account data remain unchanged
