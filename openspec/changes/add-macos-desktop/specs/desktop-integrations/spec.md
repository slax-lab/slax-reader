# Spec Delta

## Purpose

Define capture, account and subscription tools and native macOS entry points that complete the desktop reading workflow using existing service contracts.

## ADDED Requirements

### Requirement: Capture entry points require deliberate intent

The application SHALL support user-initiated URL/PDF drops, a native PDF open panel, URL clipboard detection and capture deep links using its environment-specific registered scheme (`slaxreader-mac://add?url=` for main). Clipboard detection SHALL suggest an action without saving automatically. Deep-link capture SHALL validate the URL and require confirmation before adding it. Unsolicited websites SHALL not silently modify the library.

#### Scenario: Website sends add deep link

- **WHEN** a page invokes a valid add URL
- **THEN** the app displays the proposed URL and does not save until the user confirms

#### Scenario: Malformed capture

- **WHEN** a drop or deep link contains an executable scheme, malformed URL or unsupported file
- **THEN** the operation is rejected without side effects

#### Scenario: Local PDF selection

- **WHEN** the user explicitly selects an eligible PDF
- **THEN** the existing file-size, signature, account and acquisition rules apply before import

### Requirement: RSS settings and account tools

The desktop application SHALL expose existing RSS feed/subscription/article operations, user settings, English/Chinese preference, feedback and account-deletion flows using existing service contracts. Account deletion SHALL show existing constraints and require explicit confirmation; failures SHALL leave recoverable application state.

#### Scenario: Deletion constraint

- **WHEN** the service reports a constraint preventing deletion
- **THEN** the app displays it and retains the account

#### Scenario: RSS failure

- **WHEN** an RSS action fails
- **THEN** the interface shows localized failure/retry behavior without losing unrelated library state

### Requirement: Entitlement and Labs remain server owned

Acquisition gates and subscription rights SHALL follow the existing account/service state. Existing saved content SHALL remain readable when a related acquisition toggle is off. Billing actions SHALL open validated Web subscription/Stripe entry points in the system browser, and entitlement SHALL become effective from synchronized account subscription data rather than from a browser-return parameter.

#### Scenario: Billing browser returns

- **WHEN** the browser indicates a purchase but the synchronized entitlement is unchanged
- **THEN** the application does not grant access solely from that return indication

#### Scenario: Labs acquisition disabled

- **WHEN** a user without eligibility attempts a new gated PDF or media acquisition
- **THEN** the existing gate is enforced while already saved authorized content remains readable

### Requirement: Menu bar status and quick add

The macOS menu bar item SHALL display current synchronization status and offer quick add and main-window access through the same core runtime. It SHALL not create duplicate sessions or background schedulers.

#### Scenario: Quick add with hidden window

- **WHEN** the user selects Quick Add from the menu bar
- **THEN** a focused capture surface appears and confirmed work uses the current account runtime

### Requirement: First party telemetry and browser extension compatibility

Desktop product events SHALL use only the first-party events service through native transport with a recognized desktop source. Tokens, verifiers, authorization codes and document contents SHALL not appear in event payloads. Existing browser extension capture SHALL continue to feed the same synchronized library without requiring a second desktop network implementation.

#### Scenario: Event submission

- **WHEN** the desktop records an allowed product event
- **THEN** only the first-party endpoint receives a bounded redacted payload

#### Scenario: Extension saves article

- **WHEN** the existing browser extension saves an article for the active account
- **THEN** the desktop receives the normal synchronized bookmark without an incompatible extension protocol change
