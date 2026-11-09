# Web Session Cookie Issuance

## Purpose

Allow Reader Web to establish its existing shared session using a first-party HTTP response while preserving callback recovery and compatibility with installed Extensions.

## ADDED Requirements

### Requirement: Reader issues the shared session through a same-origin endpoint

Reader Web SHALL complete browser OAuth through `POST /api/auth/session`. The endpoint SHALL send `Cache-Control: no-store` on success and failure and SHALL only issue the session cookie after authentication succeeds. It SHALL preserve the cookie name, domain, root path, lifetime and JavaScript readability.

#### Scenario: OAuth login succeeds

- **WHEN** Google or Apple returns a valid code and state bound to the initiating Reader browser
- **THEN** Reader calls the existing login API with the registered callback URI and preserved attribution and referral context
- **AND** the Reader endpoint returns the shared session cookie and a safe site destination without a token in the body

#### Scenario: The request fails boundary validation

- **WHEN** Origin is missing or mismatched, the media type is unsupported, the JSON is malformed, or the state is invalid or unbound
- **THEN** the endpoint rejects the request before exchanging the authorization code
- **AND** it does not emit a Set-Cookie header

#### Scenario: The upstream result cannot establish a session

- **WHEN** the API rejects the exchange, returns an invalid or expired token, or completes after the attempt was canceled
- **THEN** the endpoint does not emit a Set-Cookie header
- **AND** the callback preserves the existing localized recovery and fresh authorization behavior

### Requirement: Reader renews its Web session through the same endpoint

Reader Web SHALL request renewal using the same-origin endpoint with the token that initiated renewal. The endpoint SHALL call the existing authenticated renewal API only when the Bearer matches the current request cookie. It SHALL return the shared cookie without a response body only for an unexpired result for the same account.

#### Scenario: Web renews its current session

- **WHEN** the Bearer matches the session cookie and the existing API issues a valid token for the same account
- **THEN** the endpoint issues the existing session cookie with `Cache-Control: no-store` and returns 204

#### Scenario: The request session changed or the renewal fails

- **WHEN** the request lacks a matching session, the upstream rejects it, or the result is invalid or belongs to another account
- **THEN** the endpoint returns an error without issuing a cookie

### Requirement: HTTP issuance preserves existing clients and session transitions

The login and renewal API contracts SHALL remain available to existing clients. The installed Extension SHALL continue to read the shared cookie. The HTTP renewal candidate SHALL pass the session transition scenarios before release.

#### Scenario: An existing client uses a shared session

- **WHEN** the user signs in and later renews or logs out
- **THEN** the installed Extension observes the existing cookie contract and the same account transitions
- **AND** the Android callback and Mobile WebView retain their existing paths

#### Scenario: Renewal overlaps a session change

- **WHEN** a previous renewal finishes after logout, replacement login or an installed Extension clearing the cookie
- **THEN** the late response does not restore or replace the active session
- **AND** a late authorization failure does not clear the replacement session
