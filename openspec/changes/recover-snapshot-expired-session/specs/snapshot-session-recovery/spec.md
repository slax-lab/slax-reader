# Spec Delta

## Purpose

Allow Web snapshot visitors to recover from rejected login cookies without misreporting authentication failures as server errors or bypassing snapshot access policy.

## ADDED Requirements

### Requirement: Content authentication failures retain their meaning

The Web snapshot content boundary SHALL preserve upstream 401, 403, and 404 access results instead of reclassifying them as 500. It MUST NOT read article body storage after metadata access is rejected. Genuine service failures SHALL remain failures rather than triggering session cleanup.

#### Scenario: Metadata rejects an expired or invalid token
- **WHEN** the metadata service returns 401 for the token supplied by the Web content loader
- **THEN** the content endpoint reports 401 and does not read an article body

#### Scenario: Metadata denies or cannot find content
- **WHEN** the metadata service returns 403 or 404
- **THEN** the Web content endpoint preserves that status and does not read an article body

#### Scenario: Content service fails
- **WHEN** metadata loading fails because of a transport failure or server error
- **THEN** the Web reports a service failure without clearing the login cookie or automatically reloading

### Requirement: Snapshot details recover a rejected cookie session

When snapshot metadata returns 401 for the current cookie-authenticated session, `/b/[id]` SHALL clear supported login-cookie scopes and user state before reloading the same URL. This SHALL work for direct server-rendered entry and client navigation. Recoverable cookie rejection MUST NOT present the fatal 500 `Content unavailable` screen. The recovery state MUST NOT expose private content or credentials.

#### Scenario: Direct entry with an expired cookie
- **WHEN** a browser opens a public snapshot directly with an expired cookie and metadata returns 401
- **THEN** after hydration the rejected session is cleared before one reload of the same URL
- **AND** the subsequent anonymous request opens the public snapshot without the fatal 500 screen

#### Scenario: Client navigation with an invalid cookie
- **WHEN** a browser navigates within the app to a public snapshot and its cookie-authenticated metadata request returns 401
- **THEN** session cleanup completes before one reload, and the public snapshot opens anonymously
- **AND** the URL's path, query, and fragment are retained

#### Scenario: Previously owned private snapshot
- **WHEN** the rejected cookie is cleared and the current snapshot is not anonymously readable
- **THEN** the anonymous request follows the existing access-denied/not-found policy without exposing the private body or triggering another reload

#### Scenario: Supported cookie scopes coexist
- **WHEN** a rejected session has multiple supported login-cookie domain variants
- **THEN** cleanup removes all supported variants before reloading and leaves unrelated cookies intact

### Requirement: Recovery is limited to the rejected cookie

The snapshot page SHALL perform at most one cleanup/reload sequence for a rejected session in a page lifecycle. It MUST NOT reload when cleanup leaves the rejected cookie available, when no cookie authenticated the rejected request, or for non-401 failures. A response belonging to a superseded account session MUST NOT clear the replacement session.

#### Scenario: Cookie cleanup does not complete
- **WHEN** session cleanup fails or the rejected cookie remains available
- **THEN** the page presents an error without automatically reloading again

#### Scenario: Anonymous or explicit-header authentication failure
- **WHEN** metadata returns 401 without a login cookie or for an overriding explicit Authorization header
- **THEN** the page preserves the authentication failure without clearing unrelated cookie state or initiating cookie recovery

#### Scenario: Session changes during the request
- **WHEN** an old metadata request returns 401 after the browser has switched sessions
- **THEN** that response does not clear the current session

#### Scenario: Valid login or non-authentication denial
- **WHEN** metadata succeeds with a valid session or fails with 403, 404, or a server error
- **THEN** cookie-rejection recovery does not run

### Requirement: Recovery preserves snapshot cache isolation

Credential-bearing requests and recovery responses SHALL remain private and non-cacheable. Recovery MUST NOT serve owner content through anonymous shared caches. The subsequent anonymous request SHALL use the current snapshot authorization and existing cache rules.

#### Scenario: Expired session with a warm visitor cache
- **WHEN** a snapshot is cached for anonymous readers and a browser requests it with a rejected cookie
- **THEN** the credential-bearing request bypasses shared HTML and the recovery response is not stored there
- **AND** any subsequent anonymous cache use still validates current access
