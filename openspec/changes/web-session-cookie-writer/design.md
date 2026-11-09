# Design

## Scope

Use the Nitro route layout from `server/api/collection/track.post.ts`. Register only the exact `/api/auth/session` path in the Pages Worker routes. The `/auth` page keeps its existing static client rendering and navigation.

## Decisions

### Keep the browser's two token exchanges

At sign-in, the existing `useAuth.grantAuth` browser request exchanges the OAuth code with `POST /v1/user/login`. Keep the current provider, registered callback URI, referral, attribution, timeout and recovery path. After a successful result, replace its session-cookie assignment with the same-origin cookie writer. Navigate after the HTTP write or an eligible JavaScript fallback succeeds.

For renewal, keep `createAccountLocaleRequest.refreshToken` calling `POST /v1/user/refresh` with the starting session token. Keep the existing checks for account, session token, task and revision immediately before the write in `UserLocaleTasks`. After those checks pass, call the cookie writer with the returned token. Preserve the direct cookie assignment in the native-managed Mobile subscription WebView. Existing Extension code continues to read the configured shared cookie.

### Set the existing cookie from one endpoint

Send JSON to `POST /api/auth/session` with same-origin credentials. For login, send `{ action: "login", state, token }`. For renewal, send `{ action: "refresh", token }` and put the starting token in `Authorization: Bearer ...`. The browser sends its current cookie automatically. The token in the body is the value already returned by the existing API.

- Require an exact Origin match with the configured Reader origin. Reject missing and null origins with 403. Require `application/json`, allowing parameters such as charset. Reject unsupported media types with 415 and malformed or invalid bodies with 400.
- Require three non-empty base64url segments, a readable numeric `exp` in the future, and the session account claim. Reject a malformed token before authentication.
- For login, bind the OAuth state to the initiating browser with a short-lived host-only attempt cookie and verify the binding before writing the session. Keep the original provider exchange in the browser. Clear the matching temporary binding when the attempt finishes.
- For renewal, compare the starting bearer with the incoming session cookie and require the new token to belong to that account. Return 409 when the request no longer matches the starting session.
- Authenticate the submitted token using the fixed existing `GET /v1/user/me` route and its bearer authentication. This adds one read per cookie write and lets the API validate the signature, issuer, audience and account status. Reject redirects, invalid credentials and verification failures. Discard profile data and return no credentials.
- Return `Cache-Control: no-store` on all handled responses. On success, return 204 and set the configured session cookie with its existing domain, root path, expiry and JavaScript readability. Leave cookie removal to the existing logout path. Keep credentials out of diagnostics.

### Fall back when the cookie writer is unavailable

Use the original JavaScript cookie write only when the request fails at the network layer, the route returns 404 or 405, or it returns 503 or 504. The writer returns 503 when its verifier cannot be reached or reports a server error. Explicit authentication, request validation and stale session responses remain authoritative. Unexpected responses and canceled operations do not trigger a fallback.

The fallback uses only the token already returned by the original login or renewal API. Before a login fallback, recheck the OAuth attempt binding and the session cookie present when login started. Before a renewal fallback, repeat the session, task and revision checks. Keep the existing cookie name, domain, path and expiration. Browser cookie lifetime under this fallback follows the previous JavaScript behavior.

### Check the session before sending a renewal write

After the original refresh response, the browser rechecks the account and starting token before sending the cookie-writing request. A late 401 only expires the session that sent it. The request-time comparison, same-tab cancellation, and the check before JavaScript fallback cover their respective stages.

### Record the deferred response-ordering risk

If another tab signs out, a new login completes, or a legacy Extension removes the cookie after the writer request has been sent, a delayed successful response can restore or replace the shared cookie. The browser applies the response header before the caller can inspect the result. A reliable fix across these callers requires a change to the shared session protocol. The requester deferred that work for this change and retained HTTP renewal. The two-stage fixture remains the reproduction for this risk. The repository review gate evaluates the result under its existing policy.

## Rollout

Exercise the normal Web entry points against a built Pages Worker, then verify real providers and the reported iPad Brave behavior in a deployed test environment. Rollback restores the two prior write sites using the same cookie scope.
