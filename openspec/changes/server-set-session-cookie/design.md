# Design

## Context

See `proposal.md`. Pages that use the login flow are prerendered and served as static files, so Nuxt route middleware runs only in the browser and Nitro server middleware never sees those page requests. A Nitro API route is reached on every call and does not require SSR.

## Decisions

### Same-origin token-mediating endpoint

The browser posts the token it already holds to `/api/auth/session`, and the endpoint returns it as `Set-Cookie`. The token is not exposed to any new party: page scripts, the Web Function, the API, and the Extension already receive it. Writing from the Web origin avoids cross-subdomain credentialed CORS and cloaking classification that an API-domain cookie could trigger.

### Login CSRF protection with an exact Origin check

Without checks, another site could make a victim's browser adopt the attacker's token. Browsers attach `Origin` to cross-origin `POST` requests, including form submissions, and pages cannot set it, so the endpoint writes a cookie only when `Origin` equals its own origin. A missing or `null` `Origin` is rejected. Signature verification is not added: only same-origin script can pass the check, and such script could already write the cookie. The endpoint returns the same 400 for every rejection because the client only needs success or failure.

### No script-write fallback

Login does not fall back to a script write: that cookie would keep the WebKit cap this change removes. In the three days of retained Cloudflare security events, `/api/*` blocks on `r.slax.com` were scanner requests, such as `/api/.env` and `POST /api/auth/signin`, which Web does not serve. `/auth` challenges were solved or bypassed during page navigation. An endpoint failure shows the existing login failure state, from which the user retries. Refresh keeps the current cookie and retries on the next daily refresh. Existing cookies migrate on their next daily refresh.

## Risks / Trade-offs

- Page scripts can still read the token, so XSS exposure is unchanged. HttpOnly cookie authentication requires API changes and is out of scope.
- If a Cloudflare managed rule ever challenges `POST /api/auth/session`, login fails visibly. Beta verification confirms the endpoint is not challenged.
