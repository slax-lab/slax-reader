# Email authentication delta

## MODIFIED Requirements

### Requirement: An email code registers or signs in a reader

The system SHALL support email-code access on Web, iOS and Android, offer its login and account-binding client UI in every Web, iOS, and Android environment, including production, and complete the existing login session only after successful verification. Extension users SHALL be able to complete login through the Web handoff. Requesting a code SHALL NOT create a user or reveal whether an account exists.

#### Scenario: An environment has the Resend API key

- **WHEN** the API has a Resend API key
- **THEN** the API makes email-code access available by default without an environment rollout gate
- **AND** sending a code reports email-code access as unavailable when the Resend API key is missing, except for reserved `internal.invalid` login requests that use backend-log delivery

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

