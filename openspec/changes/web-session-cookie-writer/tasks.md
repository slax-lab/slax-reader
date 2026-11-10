# Tasks

## 1. Implement the cookie writer

- [x] 1.1 Add the exact Nitro route and test Origin, JSON, token shape and expiry, renewal account checks, no-store and the successful cookie response without an extra API call.
- [x] 1.2 Replace the Web login cookie write after the existing browser exchange. Verify Google and Apple payloads, callback recovery, attribution, return navigation and Android handoff.
- [x] 1.3 Replace the Web renewal cookie write after the existing browser refresh and session checks. Verify the Mobile subscription WebView still uses its original path.
- [x] 1.4 Verify the JavaScript fallback on temporary cookie writer failures for login and renewal, including rejection, cancellation and stale-session cases.

## 2. Verify compatibility and ordering

- [x] 2.1 Exercise the built Pages Worker and static callback in a browser, verify the two direct browser exchanges followed by the cookie write, and run Web and strict OpenSpec checks.
- [x] 2.2 Exercise late success in both renewal stages for same-tab and cross-tab logout, replacement login and existing Extension cleanup. Exercise a late 401 and record the passing and failing cases.
- [ ] 2.3 Verify deployed OAuth and shared cookie behavior with an installed Extension and iPad Brave. Record the evidence and any remaining environment gaps.
- [x] 2.4 Serialize session cookie operations in participating Reader tabs and rerun the logout, account replacement, and stale 401 checks.
- Deferred follow-up: coordinate direct Extension cookie cleanup with Reader Web.
