# Design

## Context

The public Web configuration observed on 2026-11-09 uses a Cookie domain equal to each Reader hostname.

| Environment | Reader host | API host | Cookie domain | Cookie name |
| --- | --- | --- | --- | --- |
| [Production](https://r.slax.com/login) | `r.slax.com` | `api-reader.slax.com` | `r.slax.com` | `token` |
| [Beta](https://r-beta.slax.com/login) | `r-beta.slax.com` | `api-reader-beta.slax.com` | `r-beta.slax.com` | `beta-token` |
| [Dev](https://r.slax.dev/login) | `r.slax.dev` | `reader-api.slax.dev` | `r.slax.dev` | `token` |

Production advertises `https://reader.slax.com/auth` as the OAuth callback. An anonymous probe confirmed that the redirect to `https://r.slax.com/auth` preserves query parameters. The API hosts are siblings of the Cookie domains and cannot issue those domain cookies directly. The Extension looks up the token at `PUBLIC_BASE_URL` and filters change events by the configured Cookie domain and name.

## Goals / Non-Goals

**Goals.** Issue the existing session cookie over HTTP from the Reader host. Preserve the contracts used by Web and installed Extensions, including the behavior of token renewal and expiry.

**Non-goals.** A parent-domain Cookie migration, an `HttpOnly` session redesign, new authentication methods, and changes to JWT policy, provider registration, storage schema or the Extension package.

## Decisions

### Complete Web OAuth on `GET /auth`

Use a Nitro server middleware scoped to `GET /auth` on the configured Reader origin. Preserve the current Android branch by passing `platform=android` through to `app/pages/auth.vue` for the existing `slaxrd://` handoff. Remove the browser OAuth exchange and login Cookie write from the Web branch. Remove `/auth` from both static route lists and make it dynamic with SSR disabled. Add `/auth` to `nitro.cloudflare.pages.routes.include` and verify `dist/_routes.json` and the deployed Worker.

At Web OAuth initiation, replace the fixed nonce with cryptographic randomness. Bind the exact serialized OAuth `state` to the initiating Reader browser by storing its digest in a short-lived, host-only `SameSite=Lax` Cookie, using a `__Host-` prefix on HTTPS. Key this temporary Cookie by the validated nonce so one attempt can clear its own binding without affecting another tab. Keep the provider and existing invitation or return context in the bound state. On the Web callback, require a matching binding before exchange, validate the expected provider and approved Reader return target, and clear only the matched binding when the attempt completes. Missing, mismatched or expired state offers the default recovery action without setting the session Cookie. Keep the OAuth exchange URI from configured `AUTH_BASE_URL` even when the callback is received at the canonical `PUBLIC_BASE_URL`. The callback is a top-level cross-site navigation, so its security check is the browser-bound state. See [OAuth CSRF guidance](https://datatracker.ietf.org/doc/html/rfc9700#section-4.7.1).

The handler sends the authorization code and existing provider-specific `auth_attribution` to the API `POST /v1/user/login`. On success it calls `setCookie()` and sends a `302` to the validated destination, defaulting to `/bookmarks`. Use `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on callback responses. Preserve the missing-code route to login and the Android deep link. On exchange failure or the 20-second deadline, return to the existing localized `/auth` recovery UI with the validated provider, return destination, invitation and attribution in the recovery fragment. The retry starts a new authorization. The recovery URL carries no authorization code or token. Malformed or unbound state uses the default recovery action. Abandon a timed-out exchange before issuing the Cookie, even when the upstream completes later. Cancel pending exchanges when the incoming request signal or the response connection reports that the browser disconnected.

### Keep the upstream boundary narrow

Resolve the fixed API login path against the trusted `DWEB_API_BASE_URL`. Reject upstream redirects and forward the existing payload and necessary headers. Preserve client and device attribution, `User-Agent` and `Accept-Language`. The bound state carries the active Web locale used for login events. The Web OAuth exchange does not forward the incoming Cookie or an old Bearer. Check deployed login attribution, including Cloudflare IP and geographic fields.

Set the session Cookie only for upstream HTTP `200`, JSON `code: 200` and a usable token. The API retains signature verification. Exclude codes, tokens and Cookie values from diagnostics.

### Keep the shared Cookie and renewal compatible

Reuse `COOKIE_TOKEN_NAME`, `COOKIE_DOMAIN`, `Path=/`, and the 60-day Cookie expiry. Set `Secure` on HTTPS. Preserve existing SameSite behavior and JavaScript readability. Keep JWT expiry separate from Cookie expiry. On successful fresh login, expire the old host-only, explicit current-host and supported parent-domain variants for the same name and root path before issuing the canonical Cookie. Keep scope-aware deletion in `clearAuth()`.

Web continues to call the API directly for renewal. `app/utils/userLocaleTasks.ts` compares the starting token, account and revision immediately before writing. Verify that a delayed success or renewal authorization failure leaves a cleared or replacement session alone. The existing Mobile subscription WebView and Extension paths stay on their current contracts.

The prototype's HTTP renewal set the Cookie after the server had checked the request snapshot. An installed Extension can delete the Cookie independently, and a separate `/auth` response can write a replacement account. The prototype failed all three timing scenarios, including Web logout. The release omits the prototype Nitro renewal route and retains the existing guarded write. Any future HTTP renewal needs a new design for shared session ordering.

## Risks and rollout

- Confirm the OAuth alias, destination, Cookie scope, and Extension bridge against a deployed test Worker. An OAuth attempt started before deployment lacks the browser binding and can restart from recovery.
- A successful renewal still writes through JavaScript. Measure initial Cookie issuance and the reported iPad Brave reopen or inactivity trigger separately. Record whether Cookie loss or a server rejection comes first.
- Rollback restores the previous Web callback and writes under the same Cookie name and scope.
