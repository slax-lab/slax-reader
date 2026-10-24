# Spec Delta

## Purpose

Help people recognize when a third-party app has opened Slax Reader inside an embedded browser and guide them to the external browser without interrupting ordinary browser sessions.

## ADDED Requirements

### Requirement: Embedded browser detection is conservative

The system SHALL identify an eligible embedded browser only when the client user agent contains an explicit supported app marker or the conservative Android WebView marker, and SHALL treat unknown or ordinary external browser user agents as ineligible.

#### Scenario: Recognized WeChat user agent

- **WHEN** the client user agent contains `MicroMessenger`
- **THEN** the environment is eligible for the external-browser guidance

#### Scenario: Recognized Instagram user agent

- **WHEN** the client user agent contains `Instagram`
- **THEN** the environment is eligible for the external-browser guidance

#### Scenario: Recognized Facebook-family user agent

- **WHEN** the client user agent contains a supported Facebook-family marker such as `FBAN`, `FBAV`, `FB_IAB`, `FB4A`, or `FBIOS`
- **THEN** the environment is eligible for the external-browser guidance

#### Scenario: Recognized Android WebView user agent

- **WHEN** an Android user agent contains the WebView `; wv` marker
- **THEN** the environment is eligible for the external-browser guidance

#### Scenario: Ordinary external browser user agent

- **WHEN** the client user agent is a normal Safari, Chrome, Firefox, or Edge user agent without a supported embedded-browser marker
- **THEN** the environment is ineligible and the guidance remains hidden

#### Scenario: Unknown user agent

- **WHEN** the user agent does not match a supported marker
- **THEN** the environment is ineligible and the guidance remains hidden

### Requirement: Guidance appears on eligible Web pages

The system SHALL show a localized floating guidance card on eligible user-facing Web pages after client-side environment detection, except on protocol/document pages and technical callback or bridge routes.

#### Scenario: Eligible page in an embedded browser

- **WHEN** an eligible embedded browser opens a user-facing page outside the excluded routes
- **THEN** the page shows the external-browser guidance card with instructions to use the top-right app menu and open the URL in an external browser

#### Scenario: Protocol page in an embedded browser

- **WHEN** an eligible embedded browser opens `/privacy`, `/terms`, `/how-do-i-delete-my-account`, or `/delete-account-notice`
- **THEN** the guidance card remains hidden

#### Scenario: Technical route in an embedded browser

- **WHEN** an eligible embedded browser opens an authentication callback, extension bridge, or redirect-only route
- **THEN** the guidance card remains hidden

#### Scenario: Slax Reader native app

- **WHEN** the page runs inside the Slax Reader native app WebView
- **THEN** the guidance card remains hidden

#### Scenario: Standalone PWA

- **WHEN** the page is running in standalone PWA display mode
- **THEN** the guidance card remains hidden

### Requirement: Guidance is dismissible and accessible

The guidance card SHALL include an accessible close control, SHALL not move the page's layout when it appears or disappears, and SHALL use the Web application's semantic theme roles across light, dark, and e-ink modes.

#### Scenario: First manual dismissal

- **WHEN** the user activates the close control or drags the card upward past its dismissal threshold
- **THEN** the card disappears, records one manual close in local storage, and appears again on the next eligible visit

#### Scenario: Second manual dismissal

- **WHEN** the user manually dismisses the card for a second time
- **THEN** the card records a one-hour cooldown and remains hidden on eligible pages during that cooldown

#### Scenario: Cooldown expires

- **WHEN** an eligible page is evaluated after the one-hour cooldown expires
- **THEN** the close count resets and the guidance card is allowed to appear again

#### Scenario: Short or cancelled drag

- **WHEN** the user drags the card downward, moves it upward less than the dismissal threshold, or the pointer gesture is cancelled
- **THEN** the card returns to its resting position without recording a manual close

#### Scenario: Guidance is announced without stealing focus

- **WHEN** the card becomes visible after client-side detection
- **THEN** it exposes a polite status message and its close control has a localized accessible name without moving focus automatically

#### Scenario: Reduced motion is enabled

- **WHEN** the user prefers reduced motion
- **THEN** the card appears and disappears without nonessential animation
