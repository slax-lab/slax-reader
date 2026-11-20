# Spec Delta

## ADDED Requirements

### Requirement: Hidden tabs do not block local database startup in other tabs

While a Web page is hidden, it SHALL defer its live local query work, including resolving a query's tables, its initial run, and re-runs after local database changes. It SHALL release that work once it has remained visible for a short settling interval, re-running each affected query once. Deferral SHALL NOT drop changes: after release, live queries SHALL reflect every change made while the page was hidden. Writes from a hidden page SHALL NOT be deferred. The extension bridge frame SHALL NOT defer queries.

#### Scenario: New tab opens while background tabs watch a changing database
- **WHEN** several hidden tabs have live local queries open and synchronization keeps writing to the local database
- **AND** the user opens a new tab
- **THEN** the new tab's local database initialization completes without waiting for the hidden tabs' query work
- **AND** it does not fall back to REST because of that work

#### Scenario: Hidden tab returns to the foreground
- **WHEN** local data changes while a tab is hidden
- **AND** the tab becomes visible and stays visible
- **THEN** its live queries re-run and show the changed data without a page reload

#### Scenario: Tab is shown only briefly
- **WHEN** a hidden tab becomes visible and is hidden again before the settling interval ends, for example while another tab closes
- **THEN** its live query work remains deferred

#### Scenario: Page opened in the background
- **WHEN** a page starts while hidden, for example opened in a background tab
- **THEN** its live local data loads after the page is shown

#### Scenario: Extension bridge frame
- **WHEN** the extension bridge frame uses the local database
- **THEN** its queries and change handling run without visibility deferral

### Requirement: SDK upgrades that change the Worker protocol use a new Worker generation

A PowerSync SDK upgrade that changes the protocol between pages and the SharedWorker SHALL use a new Worker entry generation, so a page never attaches to a running SharedWorker from an incompatible SDK. The upgrade SHALL preserve the database filename, database generation, data version, stored rows, and pending local mutations.

#### Scenario: Old and new releases are open together after deployment
- **WHEN** a tab still runs the previous release's SharedWorker and a new tab loads the upgraded release
- **THEN** the new tab starts its own SharedWorker under the new generation
- **AND** both tabs read and write the same local database without errors or data loss

#### Scenario: Existing local data after the upgrade
- **WHEN** a user with an existing local database loads the upgraded release
- **THEN** the same database file and data version are used
- **AND** no reset, full re-download, or loss of pending local writes occurs
