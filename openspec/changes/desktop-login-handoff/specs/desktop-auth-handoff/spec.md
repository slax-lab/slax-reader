# Spec Delta

## Purpose

Define explicit browser authorization and a short-lived single-use PKCE handoff to the installed macOS client without exposing its bearer credentials to WebView JavaScript.

## ADDED Requirements

### Requirement: Validated browser authorization intent

The Web login flow SHALL accept only a valid macOS client intent with S256 challenge and bounded state and preserve it through the existing Google/Apple login round trip. Already-signed-in users SHALL reach a consent surface showing account identity and authorize, cancel and switch-account actions. Neither navigation nor provider success alone SHALL issue a code.

#### Scenario: Already signed in

- **WHEN** a signed-in user opens a valid macOS login intent
- **THEN** the consent surface appears rather than an automatic bookmark redirect or app authorization

#### Scenario: Provider completes

- **WHEN** a signed-out user completes Google or Apple login for a valid desktop intent
- **THEN** the same intent returns to explicit consent and no code is issued before authorization

#### Scenario: Malformed intent

- **WHEN** the request has duplicate/malformed state or challenge, unsupported client or method
- **THEN** the request is rejected without issuing a code or following an arbitrary callback

### Requirement: Authenticated short lived code issuance

Only an authenticated active account after explicit consent SHALL obtain an opaque desktop authorization code bound to that account, S256 challenge, state and deployment. A code SHALL expire after 120 seconds. The service SHALL store only its hash and nonredeemable binding data, and SHALL not expose a browser or desktop bearer token in the handoff URL.

#### Scenario: Consent granted

- **WHEN** an active account explicitly authorizes a valid desktop intent
- **THEN** the service issues a fresh bound code and returns its expiration

#### Scenario: Inactive account

- **WHEN** an unauthenticated or deleted account attempts issuance
- **THEN** issuance fails without creating a usable code

### Requirement: Atomic single use PKCE redemption

The public exchange SHALL require a valid unexpired unconsumed code, its matching S256 verifier and state, and the same trusted deployment binding. A same-deployment exchange attempt SHALL atomically delete its matching code record before validation/signing, whether it succeeds or fails, and yield at most one desktop session across concurrent service instances. Issuance/exchange maintenance SHALL delete consumed legacy records and expired records in bounded batches without a one-day retention window. Expired, replayed, malformed or mismatched exchanges SHALL fail without disclosing the account or code existence.

#### Scenario: Concurrent exchange

- **WHEN** two independent requests redeem the same valid code concurrently
- **THEN** at most one succeeds and subsequent attempts fail

#### Scenario: Wrong verifier or state

- **WHEN** a caller has a code but lacks its bound verifier or state
- **THEN** redemption fails and no session is returned

#### Scenario: Expired or cross environment

- **WHEN** an expired code or a code from another deployment is redeemed
- **THEN** redemption fails even if the supplied verifier matches

#### Scenario: Failure after consumption

- **WHEN** token signing or response delivery fails after atomic consumption
- **THEN** the attempt fails closed and requires new authorization rather than making a bearer response replayable

### Requirement: Public exchange rate limits and routing

The exchange SHALL be reachable without a bearer session only at its exact public route and SHALL enforce bounded input and rate limiting before expensive work. Issuance SHALL remain authenticated. Core and trusted Edge forwarding paths SHALL enforce equivalent protection; missing deployed rate-limit configuration SHALL fail closed.

#### Scenario: Limit reached

- **WHEN** a client exceeds the exchange limit
- **THEN** the service returns 429 without consuming an otherwise valid code

#### Scenario: Edge forwarding

- **WHEN** an exchange request traverses the trusted Edge-to-Core path
- **THEN** the public route and rate limit are enforced without creating an unauthenticated neighboring route bypass

### Requirement: Fixed application callback and retry UI

Web SHALL select a fixed callback from its trusted build environment: development/local uses `slaxreader-mac-local://auth`, preview uses `slaxreader-mac-preview://auth`, beta uses `slaxreader-mac-beta://auth`, and production/main retains `slaxreader-mac://auth`. Each callback SHALL contain only encoded code and state, with a visible Open Slax Reader action for a failed automatic launch. Web SHALL not accept caller-selected environments, callback schemes/hosts or transmit verifier, provider credentials or bearer tokens through a URL. Expired/consumed codes SHALL require a new explicit authorization action.

#### Scenario: Automatic launch fails

- **WHEN** the installed app does not open after authorization
- **THEN** the user can activate the same still-valid callback explicitly or restart authorization when expired

#### Scenario: Redirect injection

- **WHEN** a request supplies an alternate callback or a token-bearing redirect
- **THEN** it is rejected or ignored in favor of the fixed code/state-only callback

#### Scenario: Callback environment isolation

- **WHEN** consent runs on a preview Web build while other desktop environments are installed
- **THEN** the callback uses only the fixed preview scheme from trusted Web configuration and no query parameter can switch it to main or local

### Requirement: Native pending attempt validation

The native client SHALL own a random verifier/state with a 10-minute deadline in credential storage and accept only the exact callback shape for the current attempt and expected server. Duplicate delivery SHALL cause at most one exchange. Mismatched/stale links SHALL not replace an account, reveal credentials or erase a different valid pending attempt. Only a still-current successful response SHALL be persisted before a sanitized login-state event is published.

#### Scenario: Wrong state deep link

- **WHEN** a callback contains a state different from the active pending attempt
- **THEN** no exchange occurs and the valid pending attempt remains available

#### Scenario: Duplicate delivery

- **WHEN** launch and open-URL handlers both receive the same valid callback
- **THEN** at most one bounded exchange occurs

#### Scenario: Attempt replaced in flight

- **WHEN** a successful response arrives after login cancellation or replacement
- **THEN** the old session is not stored or exposed to UI

### Requirement: Desktop session compatibility and refresh

The exchanged session SHALL be uniquely issued for desktop, carry a signed macOS client marker and remain compatible with existing protected Reader APIs and credential refresh. The marker SHALL survive trusted authentication/Edge propagation and refresh. Existing non-desktop Google/Apple/Web/Mobile/CLI/Extension login behavior and account eligibility checks SHALL remain unchanged.

#### Scenario: Desktop refresh

- **WHEN** the new desktop session calls protected APIs and refreshes
- **THEN** authorized requests succeed and the refreshed token retains its verified desktop marker

#### Scenario: Account deleted before redemption

- **WHEN** the account becomes ineligible after code issuance
- **THEN** exchange fails and no active session is created

#### Scenario: Legacy client

- **WHEN** an existing client with no desktop intent signs in or refreshes
- **THEN** its established provider and session behavior remains unchanged

### Requirement: Secret minimization and installed acceptance

Authorization responses SHALL prevent caching and referrer leakage. Logs, events and UI state SHALL exclude codes, verifiers, bearer tokens and complete callback URLs. End-to-end macOS acceptance SHALL exercise a bundled installed app for signed-in/signed-out browsers, Google/Apple, cancellation, replay and expiry; unit mocks SHALL not be reported as installed deep-link validation.

#### Scenario: Diagnostics on failure

- **WHEN** an exchange or deep-link operation fails
- **THEN** diagnostics contain a stable redacted failure class and no redeemable secret

#### Scenario: Browser consent across local ports

- **WHEN** the Web consent page at the configured origin calls the authenticated issuance API on a different origin or port
- **THEN** preflight and all issuance responses include the API CORS headers, successful code data is readable by the browser, and failed requests expose the real HTTP error without losing no-store/referrer protections

#### Scenario: Installed handoff

- **WHEN** a bundled installed app completes browser authorization
- **THEN** Rust receives and validates the callback, stores the session and the UI receives only sanitized authenticated state
