# Passkey authentication

## ADDED Requirements

### Requirement: Existing readers register credentials explicitly

The system SHALL register Passkeys only for an active authenticated account with a verified mail binding, verify the registration response, and atomically persist the credential and one account-level passkey summary.

#### Scenario: A reader adds another Passkey

- **WHEN** a signed-in mailbox owner completes a valid registration challenge
- **THEN** the credential belongs to that same account and existing mailbox/provider identities are retained
- **AND** a second credential does not create a second summary binding or account

#### Scenario: Registration is unauthorized or invalid

- **WHEN** the session, mailbox ownership, challenge, origin, RP ID, or user verification is invalid
- **THEN** no credential or summary is created

### Requirement: Passkey assertions complete the existing login

The system SHALL authenticate the verified mailbox account using a registered credential through the existing login endpoint, enforce a five-minute one-use challenge, and retain the existing session/attribution/device lifecycle.

#### Scenario: A valid assertion identifies the mailbox owner

- **WHEN** the reader submits a valid matching assertion
- **THEN** the system returns the original account and normal login response without sending mail
- **AND** Web retains the entered mailbox and the successful-submission navigation lock consistently with email-code login

#### Scenario: An anonymous caller requests login options

- **WHEN** a syntactically valid mailbox is supplied with or without a registered account or credential
- **THEN** the public challenge response contains the same discoverable-credential option shape and no account-specific credential list
- **AND** only a valid assertion for that mailbox's active account can complete login

#### Scenario: Proof is expired, replayed, mismatched or deleted

- **WHEN** a challenge is expired or already consumed, a credential belongs to another mailbox/RP, or the account or credential is deleted
- **THEN** authentication fails without creating an account or changing existing identity ownership

### Requirement: Credentials are managed only by their owner

The system SHALL expose credential management metadata only to the active authenticated owner, delete only that owner's selected credential, and remove the summary after the last credential is deleted. Credential records SHALL remain outside client local-first synchronization.

#### Scenario: The last credential is removed

- **WHEN** the owner deletes the last Passkey
- **THEN** its credential and summary are removed together while existing email/provider login remains available

#### Scenario: Another account supplies a credential ID

- **WHEN** the ID belongs to another reader
- **THEN** the request cannot read or delete that credential

### Requirement: Clients preserve approved presentation and ownership

Web and Mobile SHALL use existing login/account structures, account/session lifecycle guards and rollout profiles. Unsupported or canceled Passkey operations SHALL leave email/provider login usable.

#### Scenario: A client is replaced or an operation is dismissed

- **WHEN** an account, API origin, or active login operation changes during a native/browser prompt or HTTP request
- **THEN** its late result does not attach a credential or establish a replacement session

#### Scenario: An environment displays authentication controls

- **WHEN** the Web profile is development/preview/beta, or Mobile is development, uses the current Beta API, or is configured for the preview/Beta Web origin
- **THEN** its existing authentication surfaces offer Passkey actions with usable localized controls
- **AND** production keeps all Passkey login and management controls hidden without gating the backend by rollout environment
- **AND** existing email/provider visibility and interaction remain consistent with the latest approved base implementation

#### Scenario: A pointer hovers an email authentication action

- **WHEN** an enabled email-code or Passkey login action is hovered
- **THEN** its border uses the existing soft-accent hover role rather than the foreground text color
- **AND** the Passkey action retains the existing secondary-button hover surface and visible keyboard focus

### Requirement: Browser capability and autofill preserve mailbox-first login

Web SHALL use asynchronous Passkey capability detection for manual login and independently detect conditional UI/autofill support. Conditional authentication SHALL start only after a valid committed mailbox and SHALL reuse the existing mailbox-scoped challenge and login flow.

#### Scenario: A browser supports manual login but not conditional UI

- **WHEN** Passkey login is supported and conditional authentication is unavailable or unknown
- **THEN** the manual Passkey action remains usable without starting a conditional request
- **AND** missing newer client-capability APIs do not hide the existing manual entry on supported WebAuthn browsers

#### Scenario: A reader edits or leaves an autofill attempt

- **WHEN** the reader changes email, chooses code/provider/manual login, dismisses the form or its owner is replaced
- **THEN** the background request is canceled and its late result cannot verify or adopt a session
- **AND** email/code controls remain usable while waiting for autofill, while selected-credential verification retains the normal pending lock

### Requirement: Credential-manager signals reflect authoritative server state

After a successful credential deletion, Web SHALL best-effort signal the complete remaining credential set for the authenticated account and RP. Unknown-credential signals SHALL be limited to server-confirmed absence in that RP.

#### Scenario: A reader deletes a credential

- **WHEN** the owner deletes a credential by its numeric row ID
- **THEN** the server returns the RP ID, exact registration user handle and complete remaining credential IDs
- **AND** unavailable or failed browser reconciliation does not change the successful deletion result

#### Scenario: An assertion is rejected

- **WHEN** the server explicitly confirms that its credential ID is absent from the RP
- **THEN** Web may signal that unknown credential
- **AND** other failures, including a valid credential selected for the wrong mailbox, never send an unknown-credential signal

### Requirement: Mobile capability uses the existing adapter boundary

Mobile SHALL obtain Passkey capability from a maintained third-party plugin through its native adapter port and SHALL retain existing cancellable ceremonies and account/session ownership.

#### Scenario: A device does not support Passkeys

- **WHEN** the capability plugin reports unsupported
- **THEN** login and creation actions are unavailable while existing email/provider login and authenticated credential deletion remain usable
