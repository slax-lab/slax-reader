# Spec Delta

## ADDED Requirements

### Requirement: Web persists the login cookie through a server response

Web SHALL store the login JWT with an HTTP `Set-Cookie` response from its own origin rather than a script cookie write, so browser limits on script-written cookies do not shorten the session. The cookie SHALL keep the existing name, `Path=/`, configured domain, and 60-day lifetime, and SHALL use `SameSite=Lax` and `Secure` on HTTPS. The endpoint MUST reject requests without an exact same-origin `Origin` and values that are not JWT-shaped, without setting a cookie. Its responses MUST NOT be cached and it MUST NOT log the token. If the endpoint fails during login, Web SHALL still complete login with the previous script write.

#### Scenario: Login stores a server-issued cookie
- **WHEN** a user completes Web login
- **THEN** the login cookie is set by the session endpoint's response with the configured name, domain, path, and a 60-day lifetime
- **AND** page scripts can still read it for authenticated requests

#### Scenario: Daily refresh replaces the cookie through the server
- **WHEN** the daily token refresh receives a valid replacement token
- **THEN** the replacement is stored through the session endpoint
- **AND** the refresh completes only after that write finishes
- **AND** an endpoint failure keeps the existing cookie

#### Scenario: Another site attempts to set a session
- **WHEN** a request to the session endpoint has a missing or different `Origin`
- **THEN** it is rejected and no cookie is set

#### Scenario: Session endpoint fails during login
- **WHEN** the session endpoint is unreachable or returns an error after a successful login exchange
- **THEN** Web stores the token with the previous script write and completes login
