## Purpose

Allow the Web reader to read private media API responses across the API origin without weakening access checks.

## ADDED Requirements

### Requirement: Browser-readable private media responses

Media status, content, translation, generate, and retry responses SHALL retain JSON content type and API CORS headers with `Cache-Control: private, no-store`. Custom response headers SHALL preserve defaults unless explicitly overridden.

#### Scenario: Cross-origin status response
- **WHEN** the Web reader requests YouTube or podcast status from the API origin
- **THEN** the browser can read the JSON response and the response remains private and non-cacheable

#### Scenario: Explicit response header override
- **WHEN** a JSON caller supplies a custom cache policy
- **THEN** the response retains its JSON content type and CORS policy
