# Design

## Context

The Reader host owns the existing session cookie. The API host is its sibling. The production OAuth alias preserves the query when it redirects to the canonical Reader host. Use the registered `AUTH_BASE_URL` when exchanging the code and `PUBLIC_BASE_URL` when checking the browser POST origin.

## Goals and non-goals

Issue the shared cookie from one same-origin HTTP endpoint and preserve the Web callback and installed Extension contracts. Retain the existing API authentication, JWT lifetime, cookie scope, Android handoff, Mobile WebView and release configuration. Keep the existing recovery view and provider retry flow.

## Decisions

### Use the client callback and a Nitro POST route

Follow the server route structure of `collection/track.post.ts`. The browser posts `{ action: "login", code, state }` to `/api/auth/session`. Use JSON and same-origin credentials. Add the exact path to the Pages Worker route allowlist. Use the existing prerendered client-only callback page. The JSON request omits the callback URL as its referrer.

Set `Cache-Control: no-store` before responding. Reject missing, null or non-canonical Origin, unsupported media type and malformed JSON or body shape. Reject unbound OAuth state before contacting the fixed login API. Bind each attempt to the initiating browser with a short-lived host-only cookie containing a digest of the state and keyed by a random nonce. Clear the corresponding temporary binding on successful exchange. The page clears its binding when it finishes or abandons an attempt. Provider authorization codes retain the upstream single-use semantics. A fresh retry uses a new state and code.

The existing provider-specific attribution, referral, active locale and browser event headers travel through the proxy. Forward only the needed headers and do not forward the old session, request cookies, or untrusted IP or geographic metadata. Verify Cloudflare's IP and geographic attribution in a deployed Reader test environment. The upstream URI and provider client ID come from configuration. Reject redirects and sanitize upstream failures. Bound the upstream exchange and discard results after runtime-reported cancellation. Preserve the page deadline, existing provider recovery context and safe Reader-only destinations.

Write the cookie only after successful HTTP and API results and a usable token. Require three non-empty base64url segments and a finite, unexpired JWT expiration from the trusted upstream. The token shape check does not replace the upstream authentication. Return only the safe destination on success. Keep code, state and credentials out of error bodies and diagnostics. Preserve the configured cookie name, domain, root path, 60-day expiry and JavaScript readability, and remove supported legacy scopes on fresh login.

### Issue the renewal cookie from the same endpoint

Web sends `{ action: "refresh" }` with the initiating Bearer and the browser's cookie. Nitro returns 409 when they differ, calls the existing authenticated refresh API for a matching session, and checks that the issued token belongs to the same account. It returns the cookie with 204 and no token body. An authorization rejection returns 401 without a cookie. The client checks its current token before expiring the session on 401. The Mobile subscription WebView continues using direct API renewal.

Cancel pending renewal when the renewing tab logs out or starts a replacement renewal. The server also observes request cancellation where the runtime reports it. Request-time comparison and cancellation within the renewing tab do not coordinate a different tab or an already-installed Extension. An old response may still overwrite a replacement account or restore a cookie deleted independently.

The requester authorized connecting both paths in the candidate before ordering acceptance. Keep the release gate open until the candidate preserves logout, account replacement and legacy Extension cleanup, and keeps the replacement session after a late 401.

## Rollout

Exercise the built Pages Worker with a local synthetic provider, then use a deployed Reader test environment to check provider aliases, callback origin, attribution and the Extension. Measure iPad Brave reopen and inactivity separately from initial cookie issuance. Rollback retains the same cookie name and scope.
