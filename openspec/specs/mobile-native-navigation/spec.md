# mobile-native-navigation Specification

## Purpose
Provide genuine platform-native back controls and navigation behavior while preserving the source application's page state and dismissal rules.

## Requirements

### Requirement: Back controls and page transitions use native navigation

The application SHALL use platform-native back controls and navigation stacks for routed pages. iOS SHALL retain system back-button behavior and interactive swipe-pop; Android SHALL support system/hardware/gesture back and supported predictive-back behavior. A custom JavaScript image or pressable arrow alone MUST NOT satisfy the native-back requirement.

#### Scenario: A user returns from a routed page
- **WHEN** the user activates the platform back control or system back gesture
- **THEN** the native navigation stack returns to the correct previous route
- **AND** that route retains its source list, feed, and scroll state

### Requirement: Back dismisses transient state before leaving a page

Back handling SHALL dismiss active image viewers, sheets, drawers, dialogs, and selection state in the source-defined order before leaving the underlying route. Unsaved comment/reply input SHALL retain its discard safeguard. Native navigation and overlay handling MUST NOT produce duplicate pops or leave invisible views intercepting input.

#### Scenario: Back is used with an unsaved comment
- **WHEN** an unsaved comment panel is open and the user attempts to return
- **THEN** the existing discard flow is presented or the transient state is dismissed as appropriate
- **AND** the underlying article remains until the route transition is permitted

### Requirement: Leaving a reader performs lifecycle cleanup

Committed back navigation SHALL clear active text selection, flush article/outline positions and continue-reading state, and release page subscriptions, pending resource requests, and event listeners. Cancelling an interactive transition SHALL keep the reader functional and SHALL not apply committed-exit cleanup prematurely.

#### Scenario: An interactive iOS return is cancelled
- **WHEN** a user begins a swipe-pop and returns to the original page
- **THEN** the reader remains active with its content and interactions intact
- **AND** no second navigation or orphaned loading operation is triggered

### Requirement: Backgrounding preserves a safely resumable application

The application SHALL not retain an unnecessary cross-process file lock throughout ordinary iOS suspension. Required short-lived persistence work SHALL use bounded native background execution and release its locks on completion or expiration. Ownership coordination MUST NOT permit competing database owners or erase pending data. Presentation work SHALL not create new focus or modal actions while inactive. A terminated WebContent process SHALL be recoverable independently of the application process, preserving the active account, route, draft and reading position where available.

#### Scenario: An authenticated app backgrounds during reading
- **WHEN** the user backgrounds or locks the device while a position or preference write is pending
- **THEN** bounded persistence completes or safely cancels before suspension without retaining its file locks
- **AND** foreground return preserves valid account and navigation state without duplicate owners or destructive reinitialization

### Requirement: Authentication and callback transitions preserve stack integrity

Authentication success, sign-out, account deletion, and existing provider callbacks SHALL produce the correct source root route and account context. A completed login SHALL not leave a back path into the obsolete authentication screen. Native back SHALL not inadvertently leave or replay a provider callback or incoming share operation.

#### Scenario: Login completes
- **WHEN** the authenticated account becomes ready
- **THEN** the library becomes the application root for that account
- **AND** native back does not reveal the completed login flow
