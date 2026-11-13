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

#### Scenario: Another account supplies a credential UUID

- **WHEN** the UUID belongs to another reader
- **THEN** the request cannot read or delete that credential

### Requirement: Clients preserve approved presentation and ownership

Web and Mobile SHALL use existing login/account structures, account/session lifecycle guards and rollout profiles. Unsupported or canceled Passkey operations SHALL leave email/provider login usable.

#### Scenario: A client is replaced or an operation is dismissed

- **WHEN** an account, API origin, or active login operation changes during a native/browser prompt or HTTP request
- **THEN** its late result does not attach a credential or establish a replacement session

#### Scenario: An environment displays authentication controls

- **WHEN** the Web profile is development/preview or Mobile is development or explicitly configured for the test Web origin `https://r.slax.dev`
- **THEN** its existing authentication surfaces offer Passkey actions with usable localized controls
- **AND** beta/production keep Passkey controls hidden without gating the backend by rollout environment
- **AND** existing email/provider visibility and interaction remain consistent with the latest approved base implementation

#### Scenario: A pointer hovers an email authentication action

- **WHEN** an enabled email-code or Passkey login action is hovered
- **THEN** its border uses the existing soft-accent hover role rather than the foreground text color
- **AND** the Passkey action retains the existing secondary-button hover surface and visible keyboard focus
