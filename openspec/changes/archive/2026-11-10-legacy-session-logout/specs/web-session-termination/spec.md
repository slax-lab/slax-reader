# Spec Delta

## Purpose

Ensure Web users can end their sessions and recover from rejected login credentials when a deployment changes the scope of the login cookie.

## ADDED Requirements

### Requirement: Clear supported login-cookie scopes

The Web client SHALL remove the configured login cookie at path `/` from its host-only scope, its configured domain scope, the current hostname's explicit domain scope, and the legacy parent domain already supported by the application. It SHALL clear coexisting supported variants regardless of which value a cookie read returns. Cleanup MUST target only the configured login-cookie name and MUST remain safe when repeated or when no login cookie exists.

#### Scenario: Legacy subdomain cookie survives a domain migration
- **GIVEN** the page is hosted at `r.slax.dev`, its configured cookie domain is `slax.dev`, and its login cookie has Domain `.r.slax.dev` and Path `/`
- **WHEN** the client clears the session
- **THEN** the legacy login cookie is no longer available to the page

#### Scenario: Multiple login-cookie scopes coexist
- **GIVEN** login cookies with the configured name exist at host-only, current-host domain, and configured-parent domain scopes
- **WHEN** the client clears the session
- **THEN** all supported variants are removed
- **AND** differently named cookies remain unchanged

#### Scenario: Existing legacy-parent compatibility
- **GIVEN** the configured domain is `r.example.com` and a login cookie exists at the previously supported parent domain `example.com`
- **WHEN** the client clears the session
- **THEN** the parent-domain login cookie is also removed

#### Scenario: Local development and repeated cleanup
- **GIVEN** the page runs on `localhost` with a host-only login cookie
- **WHEN** the client clears the session twice
- **THEN** no login cookie remains and repeated cleanup completes successfully

### Requirement: Logout reaches the login page after cleanup

Manual logout SHALL complete login-cookie and user-state cleanup before navigating to `/login`. A removed session MUST NOT be treated as authenticated by the route guard because of a supported legacy cookie variant.

#### Scenario: Manual logout from a migrated session
- **GIVEN** a user is on `/bookmarks` with a legacy login cookie at the current hostname's domain scope
- **WHEN** the user selects Logout
- **THEN** the application clears the supported login-cookie variants and user state
- **AND** it navigates to `/login` without being redirected back to `/bookmarks`

### Requirement: Rejected sessions recover through shared cleanup

The Web client's existing HTTP 401 session-termination paths SHALL use the same domain-compatible cleanup. After cleanup completes in the top-level Web page, subsequent PowerSync credential attempts MUST NOT send the removed login token, and the page SHALL be able to remain on `/login`. This recovery MUST NOT relax API authentication validation.

#### Scenario: PowerSync rejects a legacy login token
- **GIVEN** a migrated session's token is read from a legacy domain cookie
- **WHEN** `POST /v1/sync/token` returns HTTP 401
- **THEN** the client removes the session cookie and reaches `/login`
- **AND** later credential attempts after cleanup make no sync-token request until a login token is available again

#### Scenario: Another authenticated API rejects the session
- **GIVEN** a migrated session is active in the Web client
- **WHEN** a request handled by the shared HTTP client returns HTTP 401
- **THEN** the client removes the session and reaches `/login` without a cookie-induced redirect back to `/bookmarks`

#### Scenario: A fresh login still connects
- **GIVEN** the previous rejected session has been cleared
- **WHEN** the user signs in and the API issues a valid login token
- **THEN** the client can obtain PowerSync credentials using the new session
