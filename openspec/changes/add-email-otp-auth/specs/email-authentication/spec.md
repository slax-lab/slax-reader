# Email authentication delta

## Purpose

Allow readers to create or access their accounts with verified email while maintaining the same account across explicitly linked login methods.

## ADDED Requirements

### Requirement: An email code registers or signs in a reader

The system SHALL support email-code access on Web, iOS and Android, show its Web client UI only in development, preview, and beta profiles and its native Mobile UI only in development during the initial rollout, and complete the existing login session only after successful verification. Extension users SHALL be able to complete login through the Web handoff. Requesting a code SHALL NOT create a user or reveal whether an account exists.

#### Scenario: An environment has the Resend API key

- **WHEN** the API has a Resend API key
- **THEN** the API makes email-code access available by default without an environment rollout gate
- **AND** sending a code reports email-code access as unavailable when the Resend API key is missing

#### Scenario: A new reader proves an unclaimed email address

- **WHEN** a reader submits a valid unused code for an unclaimed address to the existing login endpoint
- **THEN** the system creates exactly one user and verified login-email binding and signs the reader in

#### Scenario: A returning reader proves a verified login email

- **WHEN** a reader submits a valid code for a bound address
- **THEN** the system signs in the existing active user with the same account ID and existing data

#### Scenario: An address matches an unbound historical account

- **WHEN** a verified code matches only a historical profile or provider email for an existing account
- **THEN** the reader is directed to sign in with the existing method and link the address in account settings
- **AND** the system neither signs into that account via email nor creates another user

### Requirement: Email verification expires and can be consumed once

The system SHALL deliver a six-digit code with a five-minute lifetime, a 60-second resend cooldown, and a maximum of five wrong attempts per challenge. It SHALL enforce send limits by IP address, email address, and device ID and distinguish login from binding. The system SHALL preserve a valid challenge when the send outcome is ambiguous.

#### Scenario: A device requests codes for different addresses

- **WHEN** a device reaches its sending limit while requesting codes for multiple addresses
- **THEN** the delivery endpoint rejects further requests from that device during the same window

#### Scenario: A challenge expires, is replaced, or is exhausted

- **WHEN** a code is submitted after expiry, replacement, or exhaustion
- **THEN** the request is rejected and no new session or binding is created

#### Scenario: Concurrent requests submit the same correct code

- **WHEN** two requests attempt to verify the same valid challenge concurrently
- **THEN** at most one request consumes it successfully

### Requirement: Existing users link authentication identities explicitly

The system SHALL require an active authenticated session and proof of the added identity. An authenticated user can add one verified mailbox and one subject per supported OAuth provider. The system SHALL reject conflicts without replacing existing credentials or transferring account ownership.

#### Scenario: A Google or Apple user binds a mailbox

- **WHEN** an authenticated reader verifies the requested mailbox from Web account settings in development, preview, or beta, or from Mobile account settings in development
- **THEN** the system binds it to the current user and preserves the original user ID and profile email, including an Apple placeholder
- **AND** subsequent login using either bound method opens that account

#### Scenario: A reader uses a client outside the email rollout

- **WHEN** a reader opens production Web or a non-development native Mobile login or account-settings surface
- **THEN** that client hides email login entries and code forms, and omits the entire new account sign-in methods section, including its heading, mailbox/provider linking actions, and linked identity status, even for an account with an existing mailbox binding
- **AND** the original Google and Apple login entries remain available according to the existing platform support
- **AND** callers can still issue and verify login codes and authenticated mailbox binding codes through the API when the email credentials are configured

#### Scenario: A reader uses a development client

- **WHEN** a reader opens development Web, iOS, or Android login or account settings
- **THEN** the client offers email-code login and the complete account sign-in methods section according to the existing account state

#### Scenario: A reader uses a preview or beta Web client

- **WHEN** a reader opens preview or beta Web login or account settings during the rollout
- **THEN** the client offers email-code login and the complete account sign-in methods section according to the same account rules as development
- **AND** the native Mobile development-only policy and backend API availability remain unchanged

#### Scenario: An email-first user links a provider

- **WHEN** the reader completes Google or Apple authorization from account settings and the verified subject has no conflicting owner
- **THEN** the system links the verified subject to the same user and retains the current session

#### Scenario: Someone uses an unlinked provider with an already claimed email

- **WHEN** a normal OAuth login has no matching subject binding but the email belongs to an email-enabled account
- **THEN** the system requires sign-in by an existing method before explicit linking
- **AND** it does not link the provider or create a duplicate account

#### Scenario: A binding attempt would claim someone else's identity

- **WHEN** the mailbox or provider subject belongs to another active account or a frozen reservation applies
- **THEN** the system rejects the attachment and preserves existing ownership

### Requirement: Login email bindings coexist with historical data

The system SHALL keep verified login emails separate from mail collection and historical profile email. It SHALL deny authentication for deleted accounts and remove all platform bindings during account cleanup. Existing profile-email reservations SHALL follow the existing account-deletion rules.

#### Scenario: An account has a mail-collection binding

- **WHEN** the account verifies a login mailbox or changes the mail-collection setting
- **THEN** the two bindings remain independently addressable
- **AND** changing the mail-collection setting does not overwrite or remove the verified login email

#### Scenario: Account cleanup removes a deleted reader's bindings

- **WHEN** account cleanup runs for a deleted reader
- **THEN** the system removes the reader's platform bindings, including any login mailbox binding
- **AND** a distinct bound mailbox may be used in a new account after cleanup without restoring the deleted account

### Requirement: Clients preserve the existing login and recovery behavior

The system SHALL retain the existing Google and Apple sign-in paths and use the existing destination or app session flow for verified email login.

#### Scenario: A reader returns from email verification

- **WHEN** verification succeeds on the Web or in the App
- **THEN** the client completes the normal session handoff and proceeds to its valid login destination
- **AND** an abandoned or superseded attempt does not switch the current account


### Requirement: Native email entry is subordinate to provider sign-in

In development profiles where native email authentication is available, the App SHALL present Google first, Apple login next only on its supported iOS platform, and email last. The email entry SHALL use a quieter borderless secondary treatment while preserving readable contrast, the existing touch target, busy/disabled feedback, and agreement/verification flow. Account settings SHALL present Google and Apple states/actions before the complete mailbox status/binding group; an unbound mailbox action SHALL be visually subordinate to provider-link controls. Native non-development visibility SHALL remain unchanged.

#### Scenario: Development login offers multiple methods

- **WHEN** a development iOS or Android client displays email login
- **THEN** Google precedes email, with Apple between them on iOS only
- **AND** email remains labelled and operable with its existing touch area and agreement gate while carrying less visual emphasis

#### Scenario: A reader reviews native account identities

- **WHEN** development account settings display linked or unlinked login methods
- **THEN** Google and Apple status/actions or platform guidance precede the mailbox group
- **AND** a bound address remains readable and an unbound mailbox offers the same binding flow through a quieter control

#### Scenario: A non-development native client renders authentication

- **WHEN** the App renders login or account settings outside its existing development profile
- **THEN** email entry, its code form, and the complete new sign-in methods section remain absent
