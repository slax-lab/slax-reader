# Spec Delta

## Purpose

Let a person whose Web page runs an outdated build learn that a newer version exists and refresh when they choose, so a deployment never leaves an open page silently broken.

## ADDED Requirements

### Requirement: Detect a newer published build

While a Web page is open, the system SHALL check whether a newer build has been published at least every 5 minutes, and again when the page becomes visible after being hidden. A check SHALL NOT block rendering or interaction, and a failed check SHALL be ignored until the next one. The check SHALL run only in production-mode builds.

#### Scenario: A deployment happens while the page is open

- **WHEN** a newer build is published while a page from the previous build stays open and visible
- **THEN** the page detects the newer build within 5 minutes

#### Scenario: The page returns to the foreground

- **WHEN** a page hidden during a deployment becomes visible again
- **THEN** the page checks for a newer build right away

#### Scenario: The check fails

- **WHEN** the build check request fails or returns an unreadable response
- **THEN** no notice is shown and the next scheduled check runs as usual

### Requirement: Detect a version skew that breaks a load

The system SHALL treat a version skew as detected when a dynamically imported application chunk fails to load, or when local-database initialization fails because a script or WASM resource returned a non-executable response such as an HTML page. Other initialization failures SHALL NOT be treated as a version skew.

#### Scenario: The database WASM returns an HTML page

- **WHEN** local-database initialization fails because the WASM response begins with an HTML document rather than WASM bytes
- **THEN** a version skew is detected

#### Scenario: A route chunk is missing

- **WHEN** navigating loads a chunk that the current deployment no longer serves
- **THEN** a version skew is detected

#### Scenario: Storage is unavailable

- **WHEN** local-database initialization fails because browser storage is unavailable
- **THEN** no version skew is detected

### Requirement: Prompt the user to refresh

When a newer build or a version skew is detected, the system SHALL show a notice in the top-right corner of the page stating that a new version is available, with a Refresh action that reloads the current page at the same URL and a Close action. When a version skew has broken a load, the notice SHALL state that the page is outdated and needs a refresh to keep working. The notice SHALL NOT reload the page on its own, SHALL NOT block interaction with the rest of the page, and SHALL be announced to assistive technology without moving focus. Only one notice SHALL be shown at a time. The notice SHALL follow the Web light, dark, and e-ink themes and fit the narrowest supported width.

#### Scenario: A newer build is found

- **WHEN** a newer build is detected
- **THEN** a top-right notice says a new version is available and offers Refresh and Close
- **AND** the page keeps working until the user acts

#### Scenario: The user refreshes

- **WHEN** the user activates Refresh
- **THEN** the current page reloads at its current URL and loads the newest build

#### Scenario: A skew has broken a load

- **WHEN** a version skew is detected
- **THEN** the notice says the page is outdated and needs a refresh to keep working

#### Scenario: Several signals arrive

- **WHEN** a newer build and a failed chunk are both detected
- **THEN** one notice is shown, with the outdated-page wording

### Requirement: Respect a closed notice

Closing the notice SHALL hide it for the build that triggered it, for the life of the page. A later, different build SHALL show the notice again. A version skew that breaks a load after the notice was closed SHALL show it again.

#### Scenario: The user closes the notice

- **WHEN** the user closes the notice and later checks find the same newer build
- **THEN** the notice stays hidden

#### Scenario: Another deployment follows

- **WHEN** the user closed the notice and an even newer build is then published
- **THEN** the notice appears again

### Requirement: Do not reload silently for a new build

Detecting a newer build SHALL NOT by itself reload the page, including on the next in-app navigation and when a newer Service Worker installs, activates, or takes control of the page. A newer Service Worker taking control SHALL show the notice. The Web app SHALL remain installable as a PWA. A navigation that cannot complete because its chunk failed to load MAY still reload to the requested page.

#### Scenario: A new Service Worker activates

- **WHEN** a page is open under one build's Service Worker and a deployment publishes a different Service Worker, which installs and activates
- **THEN** the page is not reloaded and keeps its in-memory state
- **AND** the new-version notice is shown

#### Scenario: Navigating after a deployment

- **WHEN** a newer build was detected and the user navigates within the app, and the destination loads
- **THEN** the navigation completes without a full reload and the notice remains
