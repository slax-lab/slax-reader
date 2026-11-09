# Proposal

## Why

An iPad Brave user reported intermittent sign-outs. Reader Web writes the shared session cookie from JavaScript after OAuth and renewal. Reader can issue the existing cookie in a first-party HTTP response. Device verification will determine whether this addresses the reported loss of session.

## What Changes

- Add the same-origin Nitro POST endpoint `/api/auth/session` and have the client-side `/auth` page use it for Google and Apple OAuth completion.
- Validate the request origin, JSON payload, browser-bound OAuth state and upstream-issued token. Return `Cache-Control: no-store` on all handled responses.
- Preserve callback recovery, redirects, referrals, acquisition and collection attribution, the Android handoff, and the existing cookie contract shared with installed Extensions.
- Use the same endpoint for Web renewal only after browser ordering verification passes for logout, account replacement and legacy Extension cleanup. Keep guarded direct renewal while the gate is open.

## Capabilities

### New Capabilities

- `web-session-cookie-issuance` covers first-party issuance of the shared Reader session cookie.

### Modified Capabilities

None. The existing callback recovery and session termination requirements continue to apply.

## Impact

Reader Web gains a Nitro route and reuses the existing login and renewal API contracts. No database, provider registration, Cloudflare binding, or application package changes are required. The requester reviewed this design before implementation and approved a replacement worktree and branch.
