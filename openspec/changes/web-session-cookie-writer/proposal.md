# Proposal

## Why

Reader Web writes the session cookie from JavaScript after OAuth login and token renewal. An iPad Brave user reported intermittent sign-outs. Issuing the cookie in a same-origin HTTP response removes the script write at those two points. Device testing is needed to measure the effect on the reported behavior.

## What Changes

- Add a single Reader Nitro endpoint, `POST /api/auth/session`, for writing an already-issued token to the existing session cookie.
- Keep the current browser requests to `/v1/user/login` and `/v1/user/refresh`. Use the new endpoint for the subsequent cookie writes. Fall back to the existing JavaScript write when the endpoint is unavailable and the browser session or login attempt is still current.
- Require the Reader Origin, JSON, and a valid unexpired token. Verify the submitted token through the existing API authentication and use `Cache-Control: no-store` on every handled response.
- Preserve the static callback, OAuth recovery and attribution, cookie scope, Android handoff, installed Extension compatibility, and native-managed Mobile subscription WebView.

## Capabilities

### New Capabilities

- `web-session-cookie-issuance` covers HTTP writing of the existing Reader Web session cookie after an existing login or renewal succeeds.

### Modified Capabilities

None. Existing OAuth recovery, login token lifetime, and session termination requirements still apply.

## Scope Decision

The requester approved deferring changes to the shared session protocol. A late HTTP renewal response can restore the session after logout or legacy Extension cleanup, or replace a new login. The overlap must occur during that second request. The fixture reproduces it, and its production frequency is unknown. The requester judged a broader Web and Extension migration disproportionate for this change and chose to retain HTTP writes for both sign-in and renewal. The existing [account locale requirement for obsolete responses](../../specs/account-locale-sync/spec.md#requirement-language-state-is-isolated-between-account-sessions) remains relevant to the observed replacement-login failure.

## Impact

Reader Web adds one Nitro route and changes its two session-cookie write sites. The API continues issuing tokens through the current login and renewal contracts. The Nitro route uses the existing authenticated profile read for token verification. The change requires no new business API, signing key in Web, database field, provider registration, or Cloudflare binding.
