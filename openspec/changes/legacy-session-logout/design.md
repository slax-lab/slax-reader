# Design

## Context

See `proposal.md` for the incident and scope. `useAuth().clearAuth()` is shared by the request interceptor and PowerSync's unauthorized callback. It currently removes the configured-domain and host-only cookies, then conditionally tries the configured domain's parent. With `COOKIE_DOMAIN=slax.dev`, that parent helper returns early. It never explicitly removes a domain cookie at `r.slax.dev`.

The investigated Chrome session distinguishes host-only deletion from deletion with `Domain=r.slax.dev`. A temporary cookie probe reproduced the failure without changing the user's login token. The route guard checks cookie presence, and the connector already skips HTTP requests when no login token is available. Existing tests mock cookie removal without modeling these scopes, so they do not reproduce the failure.

## Goals / Non-Goals

**Goals:** Keep cleanup in the shared authentication boundary, cover the observed migration, and make the manual logout sequencing explicit.

**Non-Goals:** Add no new session protocol, JWT parser, public-suffix dependency, route bypass, or database cleanup behavior. Preserve the extension bridge's existing navigation boundary.

## Decisions

### Explicitly expire each supported cookie scope

Update `clearAuth()` to remove the configured cookie at path `/` for the host-only scope, configured domain, explicit current hostname, and previously supported immediate parent of a configured domain with more than two labels. Normalize leading dots and deduplicate explicit domains. Guard browser-host access so non-browser execution does not fail. Preserve host-only cleanup for localhost and IP development hosts; an inapplicable optional domain must not prevent supported cleanup.

Do not gate domain attempts on a single cookie read: duplicate names can mask another cookie variant. Limit deletion to the configured login-cookie name and known scopes; do not walk every hostname suffix or delete unrelated cookies.

Alternatives considered:
- Restore the old deployment cookie domain: does not clean variants already created under the new domain and leaves migration handling fragile.
- Redirect unconditionally or weaken API audience checks: leaves the rejected credential in place or weakens authentication instead of repairing cleanup.

### Keep both logout paths on shared cleanup

Make the bookmarks user-menu logout handler await `clearAuth()` before its existing replace navigation. Await user-store cleanup within `clearAuth()` so its completion contract covers the state it clears. Existing request and PowerSync 401 handlers already await it, so they gain the fix without a new retry state machine. Keep API audience checks unchanged.

### Test the failure mechanism, then the user outcome

First add a failing test that invokes the actual auth cleanup against a test-only cookie model that distinguishes host-only and explicit-domain scopes. Cover simultaneous cookie variants, legacy parent compatibility, missing cookies, custom cookie names, and localhost. Do not make a no-op removal spy the only regression assertion.

Exercise real cleanup with the existing route-guard and connector behavior: logout must allow `/login`, and a 401 followed by another credential attempt must not send another request with the removed token. Cover manual logout ordering and retain the successful fresh-session path. Finally verify domain deletion in Chrome with synthetic credentials in a disposable test context; no real account token belongs in fixtures or artifacts.

## Risks / Trade-offs

- Browser cookie behavior differs from DOM emulators → use scope-aware regression coverage and a Chrome check for the explicit-domain deletion.
- A broader parent-domain cookie may be shared by sibling apps → preserve the existing configured/legacy-parent logout semantics and add only the current hostname scope.
- HTTP requests already in flight can still return 401 → require no new rejected-token requests after cleanup completes; do not promise cancellation of requests already sent.
- PowerSync already performs local account-reset cleanup on logout → do not expand that behavior or use site-wide storage clearing as a workaround.

## Migration Plan

Ship through a PR to `dev`, then the repository's normal promotion flow. On a test deployment, check an existing legacy session both by clicking Logout and by allowing a sync-token 401, then sign in again and verify synchronization. No data migration or configuration change is needed. Rollback reverts the Web change; it does not make previously rejected JWTs valid again.
