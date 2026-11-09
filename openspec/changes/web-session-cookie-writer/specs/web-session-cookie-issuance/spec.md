# Web Session Cookie Issuance

## Purpose

Persist already-issued Reader login and renewal tokens through first-party HTTP responses while retaining the existing cookie contract and client authentication flows.

## ADDED Requirements

### Requirement: Reader stores an already-issued token through a same-origin endpoint

Reader Web SHALL call the existing login and renewal APIs from the browser. After either operation succeeds, Reader Web SHALL send the issued token to `POST /api/auth/session` for the cookie write. The endpoint SHALL verify the submitted token through the existing API and SHALL respond with `Cache-Control: no-store`. It SHALL preserve the session cookie name, domain, path, lifetime and JavaScript readability.

#### Scenario: OAuth completes through the existing callback

- **WHEN** the browser's existing OAuth login request succeeds for a bound attempt
- **THEN** the browser submits the issued token to the same-origin cookie endpoint
- **AND** the endpoint authenticates it and responds with the session cookie and no response body

#### Scenario: Web renewal completes for the same session

- **WHEN** the browser's existing renewal API returns a valid token for the current account
- **THEN** the browser submits it to the cookie endpoint with the initiating session token
- **AND** the endpoint writes the cookie only when the starting token matches the request cookie and the issued token belongs to that account

#### Scenario: The request or token fails verification

- **WHEN** Origin is missing or foreign, JSON is invalid, login state is unbound, the renewal session has changed, or the token is malformed, expired or rejected by the API
- **THEN** the endpoint returns a failure response and issues no session cookie

#### Scenario: The cookie writer is temporarily unavailable

- **WHEN** the browser has an issued token and the cookie endpoint fails with a network error, a missing route or a temporary service error
- **AND** the operation has not been canceled and the initiating session or OAuth attempt is still current
- **THEN** the browser writes that token using the existing JavaScript cookie settings

#### Scenario: The cookie writer refuses the request or the initiating context changes

- **WHEN** the endpoint rejects the request or token, the request is canceled, or the initiating context changes before fallback
- **THEN** the browser does not write the session cookie through JavaScript

### Requirement: HTTP writing preserves the existing session transitions

The Web callback SHALL preserve OAuth recovery, attribution, redirects and Android handoff. The shared cookie SHALL continue to serve installed Extensions, and the native-managed Mobile subscription WebView SHALL keep its existing renewal path. The HTTP renewal candidate SHALL pass the ordering scenarios before release.

#### Scenario: An earlier renewal completes after the session changes

- **WHEN** a pending renewal API request or cookie-writing response completes after logout, replacement login or existing Extension cleanup
- **THEN** the old attempt does not restore or replace the current session
- **AND** a late 401 does not clear a replacement session
