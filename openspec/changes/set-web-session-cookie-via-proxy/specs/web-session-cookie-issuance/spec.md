# Web Session Cookie Issuance

## Purpose

Let Reader Web establish its existing browser session over HTTP while preserving the shared Cookie contract used by installed Extensions.

## ADDED Requirements

### Requirement: Reader issues its existing login cookie over same-origin HTTP

Reader Web SHALL issue its existing Cookie using `Set-Cookie` on a successful `GET /auth` redirect. This response SHALL be non-cacheable and preserve the name, domain, root path, lifetime and JavaScript readability. The direct API contracts SHALL continue to serve existing clients. The Mobile subscription WebView SHALL retain its native-managed Cookie flow.

#### Scenario: Web OAuth completes from the existing callback

- **WHEN** Google or Apple OAuth reaches `GET /auth` with a valid code and state matching the initiating Reader browser, including after redirect to the canonical host
- **THEN** Reader forwards the exchange using the registered callback URI and existing attribution data
- **AND** the Reader origin returns a `302` with the existing Cookie and an approved Reader destination

#### Scenario: OAuth state is missing, modified or expired

- **WHEN** a Web OAuth callback has no valid state bound to its initiating Reader browser
- **THEN** Reader does not exchange the authorization code, set a session Cookie or redirect to a caller-supplied target

#### Scenario: Android callback hands off to the app

- **WHEN** the existing Android callback reaches `/auth`
- **THEN** the code is handed off to the app through the existing deep link flow

#### Scenario: Exchange fails

- **WHEN** the forwarded login fails, returns a business error, or returns a missing or invalid token
- **THEN** Reader emits no session Cookie and shows the applicable recovery state

#### Scenario: OAuth recovery preserves provider and context

- **WHEN** the exchange for a valid bound Web attempt is rejected or reaches the existing 20-second deadline
- **THEN** Reader offers localized recovery with a fresh authorization using the same provider and valid return, referral and attribution context
- **AND** the failed attempt does not issue a session Cookie or replay its code

#### Scenario: The browser abandons the callback while login is pending

- **WHEN** the runtime reports that the browser has canceled its callback request during exchange
- **THEN** Reader cancels the upstream wait and issues no session Cookie or success redirect

### Requirement: HTTP login preserves shared session transitions

The issued Cookie SHALL remain readable by an already-installed compatible Extension without a package update. Web renewal SHALL continue using the existing API and guard the browser write against a cleared or replacement session. A stale renewal authorization failure SHALL NOT clear a replacement session.

#### Scenario: Extension observes the same Web login and renewal

- **WHEN** a user signs in from the Extension's existing Web login entry and Reader later renews the session
- **THEN** the installed Extension recognizes the configured Cookie after login and reads the refreshed JWT for the same account
- **AND** normal Web logout removes the session seen by both surfaces

#### Scenario: Existing legacy cookie shares the login cookie name

- **WHEN** a successful issuance occurs with a supported legacy cookie of the same name still present
- **THEN** Reader Web and the installed Extension both select the newly issued token

#### Scenario: Web session changes during renewal

- **WHEN** a Web renewal overlaps Web logout or an account change, including from another tab of the Reader origin
- **THEN** the final Cookie state reflects the completed logout or the replacement account
- **AND** a failed or late request for the old session cannot clear or replace the current session

#### Scenario: Installed Extension clears the session during renewal

- **WHEN** the existing Extension removes the active shared Cookie during an in-flight Web renewal
- **THEN** that renewal does not restore the cleared session
