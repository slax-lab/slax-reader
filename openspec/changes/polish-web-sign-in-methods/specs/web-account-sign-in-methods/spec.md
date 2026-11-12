# Web Account Sign-in Methods

## Purpose

Make the Web account's available sign-in methods recognizable, readable, and operable within the existing profile card, using the application's design contract across themes and viewport sizes.

## ADDED Requirements

### Requirement: Sign-in methods have recognizable and consistent rows

The Web account sign-in subsection SHALL be visible in development and preview and omitted in beta and production, including already-linked identities. It SHALL preserve its position within the profile card and present each available method with a leading identifying icon, a method name with secondary status beneath it, and a trailing binding action when applicable. Google and Apple SHALL use recognizable approved service artwork. Icons accompanying the visible method name SHALL be decorative to assistive technology.

#### Scenario: Development account displays its methods

- **WHEN** a reader opens account settings in development or preview with configured Google and Apple providers
- **THEN** email, Google, and Apple appear in their existing order with identifying icons and consistently aligned names, statuses, and applicable actions
- **AND** the surrounding account-card structure and page navigation remain intact

#### Scenario: A configured provider is already linked

- **WHEN** the account's returned identities include that provider
- **THEN** its row displays the existing linked status without an additional binding button
- **AND** the method name is announced once without a duplicate icon label

### Requirement: Typography and controls follow the Web profile

The subsection SHALL use the existing Web semantic typography, text, surface, border, accent, and error roles defined by `DESIGN.md`. Names, subordinate status text, and the subsection heading SHALL have an explicit visual hierarchy. Binding controls SHALL retain a minimum 44px hit-area height and visible keyboard focus. Each row SHALL provide at least 12px of vertical breathing room between its content, including its action button, and an adjacent group separator.

#### Scenario: An unbound method offers a binding action

- **WHEN** a method is unbound and its existing binding conditions are satisfied
- **THEN** its action remains visually subordinate to the account identity, uses the Web control treatment, and has space above and below it
- **AND** keyboard navigation exposes a visible focus indicator without clipping it against a separator

### Requirement: Method groups remain readable across themes and narrow widths

The subsection SHALL remain readable in light, dark, and e-ink modes and at desktop, the 768px transition, and a 320px viewport. Long email addresses and Chinese or English labels SHALL wrap without horizontal page overflow, clipped actions, or collisions with icons. Approved brand artwork SHALL retain its paint policy and remain identifiable against the row surface.

#### Scenario: Narrow view contains a long verified mailbox

- **WHEN** a reader views a bound mailbox with a long address at 320px
- **THEN** its status wraps within the method content column and the icon and any available action remain usable
- **AND** the account card does not introduce horizontal page scrolling

#### Scenario: E-ink mode is active

- **WHEN** the subsection is displayed in e-ink mode
- **THEN** its text, separators, icons, and controls remain distinguishable without relying on shadows, animation, or status color alone

### Requirement: Expanded binding retains its existing interaction semantics

The visual update SHALL keep the existing email verification steps and provider linking flow. The expanded email form SHALL belong to the email method group, with its spacing contained before the next method separator. Existing busy/disabled, error, unavailable, success-announcement, and post-binding focus behavior SHALL remain operable.

#### Scenario: A reader binds a mailbox

- **WHEN** an authenticated reader expands the email method and successfully verifies its code
- **THEN** the form closes, the bound status updates, the success announcement is available to assistive technology, and focus returns to the email row
- **AND** the existing account and linked providers are preserved

#### Scenario: Provider linking is unavailable at the current origin

- **WHEN** the existing callback-origin rule makes provider linking unavailable
- **THEN** method names and their states remain readable, unavailable actions are omitted, and the existing explanatory note remains visible

#### Scenario: Verification fails or is in progress

- **WHEN** a binding request is in progress or returns an existing verification error
- **THEN** its existing busy/disabled or actionable error feedback remains available without overlapping another method row

### Requirement: Account binding uses compact input and action rows

The expanded account email-binding form SHALL place the address input and send action on the same row, and the verification-code input and verify action on the same row in the next stage. This layout SHALL remain usable at 320px without horizontal page overflow. Field labels SHALL remain accessible and visible; status, expiry, and errors SHALL have their own full-width feedback area. The existing verification stages, keyboard submission, busy/disabled behavior, resend cooldown, and change-address action SHALL remain available.

#### Scenario: A reader enters an address in account settings

- **WHEN** a reader expands email binding on a desktop or 320px viewport
- **THEN** the labelled address input and send action appear side by side with aligned control bottoms and at least 44px hit-area heights
- **AND** sending a code advances to a labelled code input with its verification action beside it

#### Scenario: Verification feedback expands the compact form

- **WHEN** sending or verification displays a status, expiry notice, or error
- **THEN** the feedback wraps within the form below or above the control row without displacing its action onto a separate full-width row
- **AND** the reader can correct the value, resend when eligible, change address, or submit from the keyboard using the existing flow

### Requirement: Small screens preserve compact method rows

At the supported 320px viewport and common phone widths, the module SHALL retain a leading icon, readable name/status stack, and trailing action on the same method row. Controls SHALL preserve at least 44px hit-area heights. The expanded Cancel control SHALL be visually subordinate to the form's send/verify action. The binding form SHALL use the available narrow-screen width and readable input text while retaining side-by-side input/action controls; it SHALL align with the method text when sufficient width is available.

#### Scenario: A reader opens settings on a small phone

- **WHEN** the module is displayed at 320px, 360px, 375px, or 390px in either supported locale
- **THEN** binding and cancellation actions remain beside their method labels instead of occupying forced extra rows
- **AND** opening email binding preserves a readable editable field beside its submit action with no horizontal page overflow
