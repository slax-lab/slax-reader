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

### Requirement: HTTP writing preserves the login flow and checks the starting session

The Web callback SHALL preserve OAuth recovery, attribution, redirects and Android handoff. The shared cookie SHALL continue to serve installed Extensions, and the native-managed Mobile subscription WebView SHALL keep its existing renewal path. Web SHALL check whether the starting session is still current before sending the renewal cookie-writing request. Reader top-level tabs that share a Web Locks storage bucket SHALL serialize login and renewal cookie writes and logout clears. The proposal and validation record describe the residual race for callers outside that lock.

#### Scenario: The original renewal succeeds after the session changes

- **WHEN** the original renewal API returns a token after logout, replacement login or existing Extension cleanup
- **THEN** Web skips the cookie write for the old attempt

#### Scenario: A participating tab logs out or completes a replacement login during renewal

- **WHEN** a Reader tab clears or replaces the session while another participating tab is completing renewal
- **THEN** the operations run in lock order and the old renewal cannot restore an ended session or overwrite the replacement
- **AND** a queued automatic cleanup for a superseded token does not clear the replacement

#### Scenario: The original renewal returns 401 after the session changes

- **WHEN** the original renewal API returns 401 for a superseded token
- **THEN** the response does not clear the replacement session
