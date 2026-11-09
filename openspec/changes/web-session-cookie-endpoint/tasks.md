# Tasks

## 1. Issue the login cookie over HTTP

- [x] 1.1 Implement the Nitro POST boundary and verify Origin, JSON, OAuth binding, upstream token validation and no-store on the actual response.
- [x] 1.2 Connect the client callback, preserve the existing attribution and recovery flows, and verify the static callback and Android handoff.

## 2. Verify rollout and renewal compatibility

- [x] 2.1 Exercise the built Pages Worker and the callback in a local browser, run Web and OpenSpec checks, and record evidence and environment gaps.
- [ ] 2.2 Exercise the deployed provider callbacks, attribution, installed Extension and iPad Brave. Record the specific environment gaps until deployed verification is available.
- [x] 2.3 Connect Web renewal to the same endpoint in the review candidate. Verify normal renewal, request-session mismatch, same-account issuance, and the direct Mobile WebView path.
- [ ] 2.4 Pass delayed renewal after Web logout, account replacement and legacy Extension cleanup, and a late 401 before releasing HTTP renewal.
