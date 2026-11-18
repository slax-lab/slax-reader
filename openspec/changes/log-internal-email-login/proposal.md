# Proposal

## Why

Internal test addresses cannot receive mail. Operators need the generated email code in backend logs to test existing login without calling Resend.

## What Changes

- Login requests for the exact normalized `internal.invalid` domain skip Resend and log the email and generated code after normal Redis admission and storage. This delivery branch does not require a Resend key.
- Preserve the existing send response, five-minute expiry, cooldown, attempt/send limits, verified-mailbox ownership and one-time consumption.
- Ordinary email delivery and authenticated mailbox binding remain unchanged. No code is returned in the send response; only reserved internal login addresses use the logging exception.

## Capabilities

### New Capabilities

- `internal-email-login`: log-only delivery for reserved internal login addresses.

### Modified Capabilities

- `email-authentication`: exempt internal log-only login from the Resend-key prerequisite while retaining ordinary-mail configuration checks.

## Impact

Only the existing API email-code domain service, its constant configuration, and related tests. No contract, route, database, Redis implementation, dependency, environment variable, Web/App implementation or package output change.

## Review Status

On 2026-11-18 the change requester explicitly revised the request to deliver an independent code-only backend PR first so colleagues can test with codes. Login-link logging is deferred to the subsequent link feature PR. This is the authorized implementation scope.
