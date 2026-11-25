# Offer the prior reading language when sign-in changes the interface

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The report saw a Chinese share turn into an English library for a test identity. The profile merge prioritizes the account language, and the current login response does not reliably distinguish a newly created account from a returning one.

## What Changes

- When the account language differs from the Web language used to start sign-in, offer a one-time explicit choice to continue in the prior language or keep the account language.
- When the reader keeps English or dismisses the offer and refreshes, English remains selected and the same completed sign-in does not prompt again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-locale-sync` — Offer the prior reading language when sign-in changes the interface.

## Impact

apps/web/app/utils/userLocaleTasks.ts, Web sign-in return surfaces and the existing account-language update flow.

Proposed Web-only remedy for the conditional finding, approved in proposal review. Sequence after fix-expired-session-cold-start for account-locale-sync.

[userLocaleTasks.ts](../../../apps/web/app/utils/userLocaleTasks.ts) · [useAuth.ts](../../../apps/web/app/composables/useAuth.ts)
