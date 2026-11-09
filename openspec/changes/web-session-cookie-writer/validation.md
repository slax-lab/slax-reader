# Validation

The implementation is available for review on `fix/web-session-cookie-writer`. The renewal ordering gate is still open.

## Automated checks

- Web typecheck passed with the repository's documented synthetic Web configuration.
- Web Vitest suite: 2,727 passed and 3 skipped. After the final token shape check, all 18 focused route tests passed.
- ESLint passed on changed source and test files. The full Web lint still reports 89 import-order errors on untouched files.
- Strict OpenSpec validation: 119 passed, 0 failed.

## Running environment

Built the Web application with the `cloudflare-pages` preset. The generated Pages manifest includes the exact `/api/auth/session` route and leaves `/auth` as a static HTML asset. Wrangler Pages served the build on port 3320; the fixture API on port 8790 used synthetic accounts and tokens.

In a browser, followed the synthetic Google and Apple callbacks into the actual static page. Both navigated to their original return target after the cookie response. The fixture recorded the existing browser `POST /v1/user/login` with provider, client ID, callback URI, referral and acquisition attribution. It then recorded server-side `GET /v1/user/me` verification. Initial navigation also triggered the real Web startup renewal: the browser called `POST /v1/user/refresh`, then the Worker verified the returned credential. The route's 204 response, unchanged cookie scope, and response caching controls were also verified by the route tests and local Worker probe.

In the existing callback fixture, disconnect and provider errors showed the persistent sign-in recovery view. The successful callback reached the original destination. Unit tests cover callback timeout and cancellation, retry attribution, and Android handoff. Store tests cover the native subscription route retaining its existing JavaScript cookie write.

For local review, run `node apps/web/tests/fixtures/auth-recovery/serve.mjs 44022` and open `http://127.0.0.1:44022/`. To repeat the Pages Worker exercise, build with `PUBLIC_BASE_URL`, `AUTH_BASE_URL` and `SHARE_BASE_URL` set to `http://localhost:3320`, `DWEB_API_BASE_URL=http://127.0.0.1:8790`, `COOKIE_DOMAIN=localhost`, `COOKIE_TOKEN_NAME=reader_token`, and synthetic Google and Apple client IDs. Start the built Pages Worker on port 3320. Run `node apps/web/tests/fixtures/web-session-cookie/check.mjs --serve` and open `http://localhost:8790/fixture`; `/observations` shows which local boundary handled each request. The provider is simulated before the callback.

## Renewal ordering

Run `node apps/web/tests/fixtures/web-session-cookie/check.mjs` against the built Worker with port 8790 free. It runs the real renewal client, HTTP handler and legacy Extension cleanup service with a simulated shared cookie jar. It deliberately fails until the release gate passes.

| Delayed response | Same-tab logout | Other-tab logout | Replacement login | Legacy Extension cleanup |
| --- | --- | --- | --- | --- |
| Original `/v1/user/refresh` | Pass | Pass | Pass | Pass |
| Cookie writer waiting for `/v1/user/me` | Pass | Fail | Fail | Fail |

A late 401 from the original renewal preserved the replacement session. When the cookie writer was already waiting on verification, its late response restored or overwrote the cookie in the other three cases. Its request only carries the cookie present when it was sent. Same-tab logout aborted the local writer in the fixture; this does not give other tabs or an old Extension control over an already-sent request.

## Remaining environment checks

- Verify deployed Google and Apple OAuth, the configured Reader callback origin, and HTTPS cookie delivery with test accounts. The fixture uses HTTP on localhost.
- Verify the installed Extension and the iPad Brave report on a deployed test environment. The fixture runs the Extension cleanup code against simulated browser cookie APIs, not an installed Extension.
- Repeat the ordering checks on supported browsers before release. Full production bookmark and sync smoke flows require the configured backend and were outside the synthetic authentication fixture.
