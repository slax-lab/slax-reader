# web-local-sync Specification

## Purpose
Provide local database synchronization in the Web reader with browser-compatible initialization and bounded recovery from failed database startup.

## Requirements

### Requirement: Browser-compatible initial worker selection

In production, the Web reader SHALL attempt Dedicated Worker initialization first when SharedWorker is unavailable, the user agent matches Android/iPhone/iPod/iPad case-insensitively, or the browser exposes a truthy `window.safari` marker. Other browser environments with SharedWorker support SHALL retain SharedWorker as their initial mode. Missing browser globals SHALL NOT cause worker-policy evaluation to throw or select shared mode.

#### Scenario: Mobile browser exposes SharedWorker
- **WHEN** a production page starts with SharedWorker available and an Android, iPhone, iPod, or iPad user agent
- **THEN** its first database initialization attempt uses dedicated mode
- **AND** no shared initialization attempt or shared retry delay occurs first

#### Scenario: Desktop Safari exposes SharedWorker
- **WHEN** a production page starts with SharedWorker available and a truthy `window.safari` marker
- **THEN** its first database initialization attempt uses dedicated mode

#### Scenario: Eligible desktop browser
- **WHEN** a desktop browser exposes SharedWorker, has no mobile user-agent match, and has no truthy `window.safari` marker
- **THEN** its first database initialization attempt uses shared mode
- **AND** a Safari compatibility token in a Chrome or Edge user agent alone does not exclude the browser

#### Scenario: Browser does not expose SharedWorker
- **WHEN** a production page starts without SharedWorker support
- **THEN** its first database initialization attempt uses dedicated mode

#### Scenario: Browser globals are unavailable
- **WHEN** worker eligibility is evaluated without window or navigator
- **THEN** shared mode is ineligible without throwing an exception

### Requirement: Preserve safe local recovery

Platform selection SHALL preserve existing bounded recovery. Initialization timeout, cleanup timeout, or cleanup failure SHALL stop further local database attempts for that page initialization and select REST fallback. A definite initialization failure with completed cleanup SHALL permit the existing next-mode recovery path.

#### Scenario: Dedicated initialization does not finish
- **WHEN** a dedicated-first session reaches the initialization timeout
- **THEN** it selects REST fallback without starting another local database instance

#### Scenario: Failed dedicated database cannot be cleaned up
- **WHEN** dedicated initialization fails and cleanup times out or reports an error
- **THEN** it selects REST fallback without trying main-thread initialization

#### Scenario: Dedicated initialization fails and cleanup succeeds
- **WHEN** dedicated initialization fails before its timeout and cleanup completes successfully
- **THEN** recovery can attempt main-thread initialization

### Requirement: Preserve development and stored data behavior

Development SHALL retain main-thread initialization. Changing the initial production worker policy SHALL reuse the existing database identity and storage and SHALL NOT itself clear stored data or pending local mutations.

#### Scenario: Development session
- **WHEN** the Web reader starts in development mode
- **THEN** database initialization uses the existing main-thread path regardless of browser worker eligibility

#### Scenario: Existing Safari database
- **WHEN** a Safari session opens an existing local database after the worker policy changes
- **THEN** the selected mode uses the same database identity and storage
- **AND** the policy change does not trigger a reset or a new database generation
