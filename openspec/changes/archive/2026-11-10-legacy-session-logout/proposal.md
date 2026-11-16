# Proposal

## Why

Existing Web sessions can remain trapped on `/bookmarks` after the API rejects their login token. Browser investigation confirmed that a legacy `token` cookie scoped to `.r.slax.dev` survives logout when the deployed `COOKIE_DOMAIN` is `slax.dev`; the route guard then redirects `/login` back to `/bookmarks`, while PowerSync keeps requesting credentials with the rejected token.

## What Changes

- Clear the configured login cookie at the current hostname's explicit domain scope as well as the configured domain, host-only scope, and existing supported legacy parent scope.
- Complete authentication cleanup before manual logout navigates to `/login`; use the same cleanup for existing HTTP 401 handlers.
- Verify that legacy and current cookie variants cannot keep the route guard authenticated after logout or restart PowerSync credential requests after 401 cleanup completes.
- Add regression coverage that distinguishes domain cookies from host-only cookies, including the observed migration from `.r.slax.dev` to `slax.dev`.

## Capabilities

### New Capabilities

- `web-session-termination`: Reliable Web logout and rejected-session recovery across supported login-cookie domain migrations.

### Modified Capabilities

None.

## Impact

- Web authentication cleanup in `apps/web/app/composables/useAuth.ts` and manual logout in `apps/web/app/components/BookmarkList/BookmarksUserMenu.vue`.
- Regression coverage around Web authentication, route middleware, and PowerSync credential retrieval; the shared request and PowerSync 401 handlers already call `clearAuth()`.
- No API contract, dependency, or database-schema changes. JWT signature, issuer, expiry, and audience verification remain enforced; affected users sign in again.

## Non-goals

- Accepting legacy JWTs without the required audience, changing session lifetime, or rotating signing keys.
- Changing the deployment's configured cookie domain or adding automatic token migration.
- Redesigning PowerSync retry scheduling or its existing account-reset/data-cleanup policy.
