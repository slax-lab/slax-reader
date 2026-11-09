# Email authentication delta

## Purpose

Allow readers to create or access their accounts with verified email while maintaining the same account across explicitly linked login methods.

## ADDED Requirements

### Requirement: An email code registers or signs in a reader

The system SHALL offer email-code access on Web, iOS and Android and complete the existing login session only after successful verification. Extension users SHALL be able to complete login through the Web handoff. Requesting a code SHALL NOT create a user or reveal whether an account exists.

#### Scenario: A new reader proves an unclaimed email address

- **WHEN** a reader submits a valid unused code for an unclaimed address
- **THEN** the system creates exactly one user and verified login-email binding and signs the reader in

#### Scenario: A returning reader proves a verified login email

- **WHEN** a reader submits a valid code for a bound address
- **THEN** the system signs in the existing active user with the same account ID and existing data

#### Scenario: An address matches an unbound historical account

- **WHEN** a verified code matches only a historical profile or provider email for an existing account
- **THEN** the reader is directed to sign in with the existing method and link the address in account settings
- **AND** the system neither signs into that account via email nor creates another user

### Requirement: Email verification expires and can be consumed once

The system SHALL deliver a six-digit code with a five-minute lifetime, a 60-second resend cooldown, and a maximum of five wrong attempts per challenge. It SHALL enforce send limits and distinguish login from binding. The system SHALL preserve a valid challenge when the send outcome is ambiguous.

#### Scenario: A challenge expires, is replaced, or is exhausted

- **WHEN** a code is submitted after expiry, replacement, or exhaustion
- **THEN** the request is rejected and no new session or binding is created

#### Scenario: Concurrent requests submit the same correct code

- **WHEN** two requests attempt to verify the same valid challenge concurrently
- **THEN** at most one request consumes it successfully

### Requirement: Existing users link authentication identities explicitly

The system SHALL require an active authenticated session and proof of the added identity. An authenticated user can add one verified mailbox and one subject per supported OAuth provider. The system SHALL reject conflicts without replacing existing credentials or transferring account ownership.

#### Scenario: A Google or Apple user binds a mailbox

- **WHEN** an authenticated reader verifies the requested mailbox from account settings
- **THEN** the system binds it to the current user and preserves the original user ID and profile email, including an Apple placeholder
- **AND** subsequent login using either bound method opens that account

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

The system SHALL keep verified login emails separate from mail collection and historical profile email. It SHALL deny authentication for deleted accounts and preserve a 30-day reservation for their bound email.

#### Scenario: An account has a mail-collection binding

- **WHEN** the account verifies a login mailbox or changes the mail-collection setting
- **THEN** the two bindings remain independently addressable
- **AND** changing the mail-collection setting does not overwrite or remove the verified login email

#### Scenario: A reader claims a deleted user's bound email

- **WHEN** the email is verified before the 30-day reservation expires
- **THEN** the system refuses registration or binding
- **AND** after the reservation expires an otherwise valid registration can create a new account without restoring the deleted user

### Requirement: Clients preserve the existing login and recovery behavior

The system SHALL retain the existing Google and Apple sign-in paths and use the existing destination or app session flow for verified email login.

#### Scenario: A reader returns from email verification

- **WHEN** verification succeeds on the Web or in the App
- **THEN** the client completes the normal session handoff and proceeds to its valid login destination
- **AND** an abandoned or superseded attempt does not switch the current account
