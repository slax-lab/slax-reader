# Internal email login

## Purpose

Allow operators to test existing email-code login for reserved internal addresses by reading backend logs without relying on email delivery.

## ADDED Requirements

### Requirement: Internal login codes use backend logs instead of email

For login-purpose requests whose normalized email domain is exactly `internal.invalid`, the system SHALL log the recipient email and generated code after admitting and storing the challenge, SHALL NOT call the email provider, and SHALL NOT require its API key. The branch SHALL apply in every backend environment while retaining existing expiry, rate limits, response fields and one-time verification. No code SHALL be returned in the send response.

#### Scenario: An internal reader requests a login code

- **WHEN** a valid login-code request targets `reader@internal.invalid`
- **THEN** the backend log contains that email and its six-digit login code
- **AND** the provider is not called and the normal challenge response is returned
- **AND** the existing login endpoint can consume the code once for that address

#### Scenario: Admission or challenge storage fails

- **WHEN** an internal request exceeds an existing send guard or fails to store its challenge
- **THEN** no login code is logged and the existing failure is returned

#### Scenario: Another delivery purpose or domain is used

- **WHEN** the request is for mailbox binding or its domain is not exactly `internal.invalid`, including subdomains and suffix lookalikes
- **THEN** the existing provider delivery and key requirement apply
- **AND** this internal-delivery branch logs no email or code
