# Tasks

## 1. Implement the cookie writer

- [x] 1.1 Add the exact Nitro route and test Origin, JSON, token shape, verification, renewal account checks, no-store and the successful cookie response.
- [x] 1.2 Replace the Web login cookie write after the existing browser exchange. Verify Google and Apple payloads, callback recovery, attribution, return navigation and Android handoff.
- [x] 1.3 Replace the Web renewal cookie write after the existing browser refresh and session checks. Verify the Mobile subscription WebView still uses its original path.

## 2. Verify compatibility and ordering

- [x] 2.1 Exercise the built Pages Worker and static callback in a browser, verify the two direct browser exchanges followed by the cookie write, and run Web and strict OpenSpec checks.
- [ ] 2.2 Exercise late success in both renewal stages for same-tab and cross-tab logout, replacement login and existing Extension cleanup. Exercise a late 401 and record the results before release.
- [ ] 2.3 Verify deployed OAuth and shared cookie behavior with an installed Extension and iPad Brave. Record the evidence and any remaining environment gaps.
