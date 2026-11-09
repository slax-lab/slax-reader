# Proposal

## Why

Reader Web writes the login cookie from JavaScript after OAuth and token renewal. An iPad Brave user reported intermittent sign-outs. Browser limits on script-created cookies are a plausible cause. First-party HTTP issuance removes that dependency during sign-in. Device verification will determine how much this helps.

## What Changes

- Handle Web OAuth on the existing Reader `GET /auth` callback. Validate the browser's login attempt, call the existing API `POST /v1/user/login`, and send `Set-Cookie` on the `302` that returns the browser to its destination.
- Keep direct API renewal and the existing Web check that the starting session still owns the Cookie before a JavaScript write.
- Preserve the shared Cookie scope, JavaScript readability, OAuth destinations, account attribution and JWT policy. Exercise logout, account replacement and Extension clearing against delayed renewal.

## Capabilities

### New Capabilities

- `web-session-cookie-issuance` covers first-party issuance of the existing shared cookie during Web OAuth.

### Modified Capabilities

None. Account locale synchronization, Web session termination and snapshot recovery keep their existing requirements. The email and Passkey proposal should consume the shared cookie completion boundary if its implementation overlaps this change.

## Impact

The Web application moves the existing OAuth exchange into Nitro. The existing API endpoints remain the sole login and renewal operations and keep their current contracts. The shared Cookie continues to serve the installed Extension. There are no schema or package changes.

## Review

The initial worktree prototype exercised HTTP Cookie writes for login and renewal. Delayed renewal restored cleared sessions and overwrote a replacement account in the ordering fixture. After reviewing those results, the requester approved implementing HTTP Cookie issuance for `/auth` with the existing guarded Web renewal retained. The callback retains localized recovery, the 20-second deadline, fresh provider retry, invitations, and collection and HackerLinks attribution. HTTP renewal is outside this release scope.
