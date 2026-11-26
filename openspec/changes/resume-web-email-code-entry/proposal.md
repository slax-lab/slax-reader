# Resume an unexpired email sign-in challenge

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

The Web code form lost both its six-digit field and its running resend timer after a refresh or a modal remount in Chrome.

## What Changes

- Restore a live challenge on the original sign-in surface in the same tab. Let readers change the email or start again after expiry.
- When the challenge has expired or the reader explicitly changes the address, the stale challenge cannot be submitted and the reader can request a fresh code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-email-sign-in-continuation` — Resume an unexpired email sign-in challenge.

## Impact

apps/web/app/components/Login/EmailCodeForm.vue, EmailLoginForm.vue and the page and modal login hosts.

Coordinate with email/passkey flows. Keep the existing remembered-address preference and authentication limits.

[EmailCodeForm.vue](../../../apps/web/app/components/Login/EmailCodeForm.vue) · [Sign-in continuation contract](../../../openspec/specs/web-email-sign-in-continuation/spec.md)
