# Spec Delta

## Purpose

Make the existing Slax Reader collection experience available on accessible web pages that were opened before first installation, without requiring a page reload or bypassing browser and account restrictions.

## ADDED Requirements

### Requirement: First installation activates already-open web pages

On first installation, the extension SHALL activate its existing collection experience in already-open, loaded HTTP(S) pages where browser-granted access permits it. Activation SHALL NOT reload or navigate those pages, change the active tab, or create a bookmark by itself. Installation onboarding remains independent of page activation.

#### Scenario: Collect from a page opened before installation

- **WHEN** an authenticated user first installs the extension while a supported HTTP(S) page is already open and loaded
- **THEN** the page's collector becomes available without a user-triggered recovery injection or page reload, and the user can invoke an existing collection action and receive the normal save result for that page

#### Scenario: Several eligible tabs are open

- **WHEN** first installation occurs with several accessible loaded HTTP(S) tabs open
- **THEN** activation is attempted for each eligible tab, including inactive tabs, without reloading or navigating them

#### Scenario: Installation without a collection action

- **WHEN** first-install activation completes and the user has not invoked collection
- **THEN** activation itself creates no bookmark and does not force the collection popup open

#### Scenario: Non-install lifecycle event

- **WHEN** the extension is updated, reloaded as an update, or its background worker restarts
- **THEN** this first-install feature does not initiate a bulk tab activation pass and existing lifecycle behavior remains in effect

### Requirement: Activation respects browser restrictions and isolates failures

The extension SHALL limit proactive activation to HTTP(S) pages permitted by the browser. It SHALL NOT proactively inject into local files, browser-internal pages, other extensions, or unsupported schemes. An inaccessible, closed, or otherwise non-injectable tab SHALL NOT prevent activation of other eligible tabs or completion of normal install setup. The feature SHALL NOT reload tabs or request additional permissions as recovery.

#### Scenario: Mixed ordinary and restricted tabs

- **WHEN** installation finds ordinary web pages alongside browser-internal, extension, file, or unsupported-scheme tabs
- **THEN** ordinary permitted pages are activated and excluded tabs remain untouched

#### Scenario: Browser denies one HTTP(S) page

- **WHEN** a protected HTTP(S) page or withheld site access prevents injection
- **THEN** the denial is contained to that tab, other eligible tabs remain eligible for activation, and no browser restriction is bypassed

#### Scenario: A tab closes during activation

- **WHEN** a selected tab closes before its activation completes
- **THEN** remaining tabs and the install setup continue without an unhandled failure from that tab

### Requirement: Activated pages retain the existing collection experience

First-install activation SHALL provide the same functional collector and extension-owned styling as normal page loading. A page with a responsive existing collector SHALL reuse it rather than receive a second collector from the install pass. Authentication, collection eligibility, and existing explicit-action PDF recovery SHALL remain unchanged.

#### Scenario: Collector is already available

- **WHEN** a page already has a responsive collector when the installation pass checks it
- **THEN** the pass reuses it without introducing another collection popup or sidebar

#### Scenario: Styled collection on an activated page

- **WHEN** collection is invoked on an activated eligible page
- **THEN** the normal styled collection feedback and sidebar operate as on a freshly loaded page, with no missing extension dependency or loss of style isolation

#### Scenario: User is not signed in

- **WHEN** an unauthenticated user invokes collection on an activated page
- **THEN** the existing authentication flow remains required and activation does not bypass it or save a bookmark on the user's behalf

#### Scenario: New page is opened after installation

- **WHEN** a supported page is opened or normally navigated to after installation
- **THEN** ordinary content loading continues to provide the existing collection experience without relying on another install event

#### Scenario: Local PDF is explicitly collected

- **WHEN** a user invokes an existing collection action on a local PDF after installation
- **THEN** existing file-access guidance, PDF eligibility, and explicit-action recovery behavior remain authoritative, independent of the HTTP(S)-only installation pass
