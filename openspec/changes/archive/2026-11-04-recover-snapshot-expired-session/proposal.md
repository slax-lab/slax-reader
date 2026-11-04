# Proposal

## Why

Opening `/b/[id]` with a rejected login cookie currently turns an upstream HTTP 401 into HTTP 500 and the fatal message `Content unavailable`. The content request bypasses the shared HTTP client's session cleanup, leaving the rejected cookie in place on every reload.

## What Changes

- Preserve authentication and access-denial statuses at the Web content boundary instead of converting them into server failures.
- When snapshot metadata rejects a cookie-authenticated session with 401, clear the supported login-cookie scopes and user state, then reload the same URL once without the rejected session.
- Recover both direct SSR entry and client-side navigation without presenting the fatal content-unavailable screen for a recoverable rejected cookie.
- Let the subsequent anonymous request use existing content policy: publicly readable snapshots open; private or unavailable snapshots retain their existing denied/not-found behavior.
- Preserve real service errors and prevent repeated reloads when recovery is inapplicable or cookie cleanup fails.

## Capabilities

### New Capabilities

- `snapshot-session-recovery`: Recover rejected cookie sessions when opening Web snapshot details, preserving access decisions and bounded navigation.

### Modified Capabilities

None. This adds a snapshot-specific recovery path outside the shared HTTP client. Existing shared-client redirects remain unchanged. PowerSync session rejection coordinates with snapshot navigation and asks a mounted snapshot to recheck metadata; the snapshot page owns cleanup and reloading. Other routes retain their existing login redirect.

## Impact

- Web content loading in `apps/web/server/utils/loadContent.ts`, snapshot setup/error handling in `apps/web/app/pages/b/[id].vue`, and the focused `useSnapshotSessionRecovery` composable.
- Default-layout token refresh and PowerSync startup/unauthorized handling coordinate with the active snapshot recovery; normal authenticated startup and non-snapshot login redirects remain unchanged.
- Existing `useAuth().clearAuth()` supplies cookie-scope and user-state cleanup; no new cookie-domain policy is introduced.
- Regression tests around content loading, snapshot recovery, and cache isolation; browser verification for direct entry and navigation.
- No API authentication changes, API contract changes, dependency additions, or database migrations. No Extension, Mobile, or CLI package changes are planned.

## Non-goals

- Extending token lifetime, refreshing a rejected token, or treating decoded JWT claims as authorization.
- Changing non-snapshot 401 navigation, redesigning the generic error page, or recovering unrelated collection/share routes.
- Changing sharing policy, shared-cache eligibility, or local-first account cleanup semantics.

## Proposal approval

The user approved implementation in conversation on 2026-11-04: clear the rejected token and automatically reload the current snapshot, with no infinite reload. The user subsequently requested bug review and PR delivery. Human hands-on acceptance of the implementation remains a separate checkpoint.
