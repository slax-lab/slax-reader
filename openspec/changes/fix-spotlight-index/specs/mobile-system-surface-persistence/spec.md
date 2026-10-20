# Spec Delta

## ADDED Requirements

### Requirement: Transient readiness loss preserves published system surfaces

When discovery or donations are enabled for the active owner, Mobile SHALL keep the published Spotlight catalog, donation identifiers and pending receipts while publication readiness is temporarily unavailable, including application backgrounding and credential refresh. Mobile SHALL stop publishing new snapshots during that period and SHALL resume from the current local snapshot when readiness returns. A temporary readiness loss MUST NOT be treated as a user opt-out.

#### Scenario: Application moves to the background

- **WHEN** the user leaves the application while discovery is enabled and the catalog has eligible bookmarks
- **THEN** the published catalog and donations remain available to Shortcuts and Spotlight
- **AND** no catalog or donation deletion is requested merely because credentials paused

#### Scenario: Readiness returns

- **WHEN** credentials and the active account become ready again after a pause
- **THEN** the current local eligible snapshot is republished
- **AND** pending donation work remains retryable under the same owner

### Requirement: Revocation follows explicit user or account intent

Mobile SHALL revoke catalog entries and donations only when the corresponding setting is explicitly disabled, the user signs out, the active account or API origin changes, or the content becomes ineligible. Revocation failures SHALL remain retryable and SHALL NOT expose another owner's data.

#### Scenario: User disables system discovery

- **WHEN** the persisted discovery preference changes to false
- **THEN** Mobile removes the published catalog and retries removal on failure
- **AND** the donation preference remains independent

#### Scenario: Account or origin changes

- **WHEN** the authenticated user, API origin or native owner generation changes
- **THEN** entries and donations belonging to the previous owner are revoked before the replacement owner publishes
- **AND** a transient loss of readiness alone does not revoke them

### Requirement: Native App Intents registration precedes publication and donation

The indexed bookmark entity and the donatable open intent SHALL be registered synchronously when the app-target setup module is created, before JavaScript can publish a catalog or donate an action. Shortcut-parameter refresh MAY remain asynchronous.

#### Scenario: First successful open after launch

- **WHEN** an admitted user opens an eligible article before the asynchronous shortcut-refresh task completes
- **THEN** the donation intent is already registered and the donation can be recorded
- **AND** the open action is not left pending solely because registration was delayed

### Requirement: Pending Spotlight entry survives readiness changes

When a Spotlight open invocation arrives before the app is ready, Mobile SHALL retain it across credential, native-owner and upgrade readiness changes and route it once the current account, data and navigation are ready. An account or API-origin replacement SHALL discard pending entry work instead of navigating it under the replacement owner.

#### Scenario: Cold-start open arrives before credentials are ready

- **WHEN** the system delivers an indexed article open while credentials are still checking
- **THEN** the invocation remains pending rather than being discarded by the readiness transition
- **AND** once the account and navigation are ready, the article opens and the invocation is acknowledged

#### Scenario: Credentials pause and resume

- **WHEN** credential readiness pauses and later resumes while an open invocation is pending
- **THEN** the invocation survives both transitions
- **AND** it is not routed under a different account or API origin

#### Scenario: Account replacement with pending entry

- **WHEN** the account or API origin changes while an open invocation is pending
- **THEN** the old invocation is discarded before the replacement owner is used
- **AND** it cannot navigate content belonging to the previous account

### Requirement: Spotlight opens the selected entity

The discoverable open action SHALL conform to the platform open-intent contract and SHALL route the selected entity through the existing account-scoped entry router. Invalid or unavailable entities SHALL use the existing recoverable outcome and MUST NOT bypass admission.

#### Scenario: User taps a Spotlight result

- **WHEN** Spotlight launches the app with an indexed bookmark entity
- **THEN** the app receives that entity's identifier and opens the corresponding Reader content under the current account
- **AND** an unavailable entity produces the existing recovery outcome

## MODIFIED Requirements

None.
