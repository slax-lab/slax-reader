# Design

## Context

See `proposal.md` for motivation. The observed request path is `/b/[id]` → `useRequestFetch()` → `/api/content/[uuid]` → `loadContent()` → `BACKEND /content/meta`. The API verifies any supplied token before evaluating snapshot read access and preserves its 401 response. Web instead throws a plain Error for non-404 failures and wraps every rejected metadata request in a 500. The page then promotes that error to a fatal `Content unavailable` error. This path never uses the shared request interceptor.

A synthetic probe executed the actual loader with mocked BACKEND and OSS bindings. Upstream 401 and 403 both became 500, 404 remained 404, and successful metadata read its authorized body. No body was read for rejected metadata. This is local evidence of the failure mechanism, not a production-session capture.

Existing `useAuth().clearAuth()` already removes supported cookie scopes and awaits user-store cleanup. Existing shared-cache tests deliberately exclude every credential-bearing request, including invalid or empty credentials. Preserve both boundaries. The active `legacy-session-logout` change owns general logout cleanup; this change adds only the snapshot recovery path and its separate capability delta.

## Goals / Non-Goals

**Goals:** Preserve the content service's authentication decision, recover at the page boundary that owns browser navigation, and reuse current logout behavior.

**Non-Goals:** No server-side token decoder, anonymous retry with credentials still present, global 401-interceptor rewrite, new session endpoint, or additional storage-reset policy.

## Decisions

### Preserve explicit access errors in the loader

Preserve 401 and 403 as H3 errors through the metadata rejection handling; retain existing 404 behavior and the existing generic failure handling for transport/service faults. Do not read OSS on rejected metadata. The same-origin PDF route already demonstrates status preservation. Do not change the Core or Edge authentication logic.

### Recover cookie rejection in the snapshot page

For a content 401 attributable to the cookie credential used by that request, enter a recoverable page state instead of throwing the fatal content error. SSR must serialize this state without article or owner data so the browser can hydrate and perform cleanup; client navigation must handle the same condition. Keep the response private/no-store and avoid cache writes. Any visible pending state uses the existing loading presentation and translations.

Once the browser is ready, await `clearAuth()` and reload the current address, including its query and fragment, after confirming the rejected cookie has been removed. A full reload resets the mounted account-dependent view and fetches metadata under the anonymous access policy. Do not carry the rejected token in the URL, storage, logs, or serialized recovery state. Use existing account-generation boundaries so a response for an old session does not clear a subsequently changed session.

Only a rejected cookie used for this metadata request qualifies: no-cookie 401, an overriding explicit Authorization header, 403, 404, and genuine service failures must not delete cookies or trigger reload. Prevent duplicate cleanup/reload in one page lifecycle. If cleanup does not remove the cookie, show the existing error presentation without reloading; after successful cleanup, an anonymous 401 also cannot trigger another reload. This bounds the actual recovery mechanism without a persistent retry counter.

The final anonymous request may open a public snapshot or receive the existing 404/access denial for private content. Do not force a new login redirect or weaken the private snapshot policy.

Alternatives considered: retrying anonymously inside the loader leaves the browser holding a rejected session; changing the global HTTP interceptor does not cover SSR content fetches; unconditional reload loops on private content or undeleted cookies. A server-only Set-Cookie redirect would duplicate domain-compatible cleanup and omit client user-state cleanup, so reuse the existing browser boundary.

### Coordinate existing startup and unauthorized handlers

Running-browser review reproduced an earlier default-layout token refresh redirect to `/login`, before the page's Nuxt-ready cleanup. Expose the established recovery state through a shared, hydration-safe marker; the default layout skips its initial token refresh and PowerSync skips connection startup for this rejected document. The marker is owned by the recovery component's Vue ID so disposing an old snapshot cannot clear a newer page's recovery.

Review also reproduced PowerSync detecting JWT expiry during client navigation before metadata returned 401. A focused route middleware records a destination snapshot while its metadata decision is pending, separately from the confirmed-rejection marker. The destination page establishes recovery ownership before releasing its matching navigation marker. During either phase, PowerSync defers its unauthorized side effects. When already on a mounted snapshot, PowerSync asks that snapshot to refresh metadata instead of clearing cookies or navigating itself. The page remains the sole owner of cleanup and reloading, preventing a connector reload from preempting an unfinished destination navigation. Non-snapshot routes keep their login redirect, and extension iframe navigation remains unchanged.

Keep the original metadata error while the account generation changes during cleanup: `clearContent()` would otherwise erase the error and leave a blank page if the cookie cannot be deleted. Generation-based content isolation and clearing of marks/PDF placeholders remain active.

## Risks / Trade-offs

- SSR and hydration handle errors differently → cover initial document entry and client navigation, and verify the recoverable state survives serialization without becoming a fatal error.
- Recovery needs client JavaScript → a non-JavaScript request retains an authentication failure without private content; automatic browser cleanup occurs after hydration.
- Cookie domains differ in deployed sessions → reuse tested scope cleanup and verify host-only and explicit-domain synthetic cookies in a browser.
- Logout triggers existing account reset/watchers → do not start detail initialization or competing refresh/navigation while recovery is pending; verify that only one reload occurs.
- Public/private policy can change → the new anonymous request performs current authorization; preserve credential-bearing cache bypass and never store recovery HTML.

## Migration Plan

After proposal approval, isolate implementation on `fix/recover-snapshot-expired-session` based on `origin/dev`, preserving the current checkout's unrelated Mobile changes. Add regression coverage before fixing the loader and page. Record automated and running-browser evidence in `validation.md`, complete human hands-on acceptance before opening a task PR to `dev`, and run the repository's strict OpenSpec validation and local review. No data/configuration migration or app package-version increase is expected for this Web-only scope. Rollback reverts the Web recovery change.
