# Design

## Context

The Reader host owns the existing session cookie. The API host is its sibling. The production OAuth alias preserves the query when it redirects to the canonical Reader host. Use the registered `AUTH_BASE_URL` when exchanging the code and `PUBLIC_BASE_URL` when checking the browser POST origin.

## Goals and non-goals

Issue the shared cookie from one same-origin HTTP endpoint and preserve the Web callback and installed Extension contracts. Retain the existing API authentication, JWT lifetime, cookie scope, Android handoff, Mobile WebView and release configuration. Keep the existing recovery view and provider retry flow.

## Decisions

### Use the client callback and a Nitro POST route

Follow the server route structure of `collection/track.post.ts`. The browser posts `{ action: "login", code, state }` to `/api/auth/session`. Use JSON and same-origin credentials. Add the exact path to the Pages Worker route allowlist. Serve the callback client-side with no-store and no-referrer headers. Keep callback routing available when a prior session exists so the user can replace it.

Set `Cache-Control: no-store` before responding. Reject missing, null or non-canonical Origin, unsupported media type and malformed JSON or body shape. Reject unbound OAuth state before contacting the fixed login API. Bind each attempt to the initiating browser with a short-lived host-only cookie containing a digest of the state and keyed by a random nonce. Clear the corresponding temporary binding on successful exchange. The page clears its binding when it finishes or abandons an attempt. Provider authorization codes retain the upstream single-use semantics. A fresh retry uses a new state and code.

The existing provider-specific attribution, referral, active locale and browser event headers travel through the proxy. Forward only the needed headers and do not forward the old session, request cookies, or untrusted IP or geographic metadata. Verify Cloudflare's IP and geographic attribution in a deployed Reader test environment. The upstream URI and provider client ID come from configuration. Reject redirects and sanitize upstream failures. Bound the upstream exchange and discard results after runtime-reported cancellation. Preserve the page deadline, existing provider recovery context and safe Reader-only destinations.

Write the cookie only after successful HTTP and API results and a usable token. Require three non-empty base64url segments and a finite, unexpired JWT expiration from the trusted upstream. The token shape check does not replace the upstream authentication. Return only the safe destination on success. Keep code, state and credentials out of error bodies and diagnostics. Preserve the configured cookie name, domain, root path, 60-day expiry and JavaScript readability, and remove supported legacy scopes on fresh login.

### Gate HTTP renewal on browser ordering

The eventual `refresh` action will compare the initiating Bearer with the request cookie, use the existing authenticated refresh API and confirm the returned token belongs to the same account. These checks cover the request snapshot. They cannot prevent the browser from applying an older response after logout, a replacement login or an installed Extension's independent cookie removal. The preceding HTTP prototype reproduced those failures.

Keep the current guarded browser write until those three scenarios and a late 401 have passed against a candidate HTTP implementation. Do not expose an HTTP refresh action that can restore a stale session. The existing implementation can be shipped for sign-in independently of this gate.

## Rollout

Exercise the built Pages Worker with a local synthetic provider, then use a deployed Reader test environment to check provider aliases, callback origin, attribution and the Extension. Measure iPad Brave reopen and inactivity separately from initial cookie issuance. Rollback retains the same cookie name and scope.
