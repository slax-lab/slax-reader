# Proposal

## Why

WebKit-based browsers delete the Web login cookie long before its 60-day token expires because Web writes it through `document.cookie`. WebKit caps script-written cookies to seven days, and to one day when they are written on a landing page reached from a classified domain with link decoration, which matches the Google OAuth callback. Production analytics showed signed-in WebKit sessions repeatedly becoming anonymous about one day after login while the same account stayed valid in the iOS app.

## What Changes

- Add a same-origin Nitro endpoint, `POST /api/auth/session`, that issues the login cookie through an HTTP `Set-Cookie` response. It keeps the existing cookie name, `Path=/`, configured domain, and 60-day lifetime, adds `SameSite=Lax`, and adds `Secure` only on HTTPS. It does not add `HttpOnly`, because page scripts still read the token for Bearer requests.
- Route `/api/auth/session` through the Cloudflare Pages Function.
- Login and the existing daily token refresh persist the cookie through this endpoint. If the endpoint fails, login keeps the existing script write and refresh keeps the current cookie.
- Existing script-written cookies are not migrated separately: the next daily refresh replaces them while they are still present. A WebKit user whose cookie was already capped to one day may need to sign in once more.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `login-token-lifetime`: Web persists the login cookie through a server response so browsers keep it for the issued lifetime.

## Impact

- `apps/web`: new `server/api/auth/session.post.ts`; small changes in `app/utils/authCookie.ts`, `app/composables/useAuth.ts`, `app/stores/user.ts`, `app/utils/userLocaleTasks.ts`, and `nuxt.config.ts`; related unit tests.
- No change to the API, JWT lifetime or validation, Mobile apps, Extension code, or SSR and prerender settings. The Extension continues to read the same cookie through the browser cookies API.

## Review Status

The human reviewed this scope in conversation on 2026-11-10, approved the endpoint plus login and refresh adoption without a separate legacy-cookie migration, and asked for the smallest effective code change. A broader alternative (PR #552) was evaluated and not adopted. Stale 401 cleanup, refresh across the old expiry, the 24-hour retry interval, PowerSync credential caching, Extension PDF-save interruption, OAuth state binding, and HttpOnly cookie authentication are out of scope.
