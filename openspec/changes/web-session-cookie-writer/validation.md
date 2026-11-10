# Validation

The implementation is available for review on `fix/web-session-cookie-writer`. Reader tabs now coordinate cookie operations through Web Locks. Direct Extension cookie cleanup remains the deferred case.

## Automated checks

- Web typecheck passed again with the local development configuration after removing the profile request.
- Web Vitest suite with session locking: 2,750 passed and 3 skipped with `--maxWorkers 6 --hookTimeout 60000`. The earlier default run hit five Nuxt setup hook timeouts. After removing the profile request, 139 focused tests passed across the writer, login, user store and renewal task suites. The login and renewal assertions both detected the extra request on the previous implementation.
- ESLint passed on changed source and test files. The full Web lint still reports 89 import-order errors on untouched files.
- Strict OpenSpec validation: 119 passed, 0 failed.

## Running environment

Built the Web application with the `cloudflare-pages` preset. The generated Pages manifest includes the exact `/api/auth/session` route and leaves `/auth` as a static HTML asset. Wrangler Pages served the build on port 3320; the fixture API on port 8790 used synthetic accounts and tokens.

In the earlier browser exercise, the synthetic Google and Apple callbacks entered the actual static page and navigated to their original return target after the cookie response. The fixture recorded the existing browser `POST /v1/user/login` with provider, client ID, callback URI, referral and acquisition attribution. Initial navigation also triggered the real Web startup renewal through `POST /v1/user/refresh`.

Rebuilt and restarted the Pages Worker on port 3000 after removing the profile request. The fixture passed login and renewal against this Worker with a synthetic API on port 8794. A direct HTTP probe confirmed that the writer returns 204 with `Set-Cookie` and `Cache-Control: no-store` for a structurally valid synthetic token and a bound attempt. The real local `GET /v1/user/me` independently rejected that same token with 401. No real provider session was created by this check.

In the existing callback fixture, disconnect and provider errors showed the persistent sign-in recovery view. The successful callback reached the original destination. Unit tests cover callback timeout and cancellation, retry attribution, and Android handoff. Store tests cover the native subscription route retaining its existing JavaScript cookie write.

For local review, run `node apps/web/tests/fixtures/auth-recovery/serve.mjs 44022` and open `http://127.0.0.1:44022/`. To repeat the Pages Worker exercise, build with `PUBLIC_BASE_URL`, `AUTH_BASE_URL` and `SHARE_BASE_URL` set to `http://localhost:3320`, `DWEB_API_BASE_URL=http://127.0.0.1:8790`, `COOKIE_DOMAIN=localhost`, `COOKIE_TOKEN_NAME=reader_token`, and synthetic Google and Apple client IDs. Start the built Pages Worker on port 3320. Run `node apps/web/tests/fixtures/web-session-cookie/check.mjs --serve` and open `http://localhost:8790/fixture`; `/observations` shows which local boundary handled each request. The provider is simulated before the callback.

## JavaScript fallback

The focused Web checks cover login and renewal fallback, the accepted HTTP status codes, missing login tokens, validation failures, cancellation, and a changed session or OAuth attempt. The renewal fixture injects a 503 for the cookie-writing request and checks that the existing renewal client writes the issued token through JavaScript. The deployed iPad Brave check applies to the normal HTTP path.

For the renewal check, keep the fixture API port free and run `node apps/web/tests/fixtures/web-session-cookie/check.mjs --skip-ordering` against the Worker. The fixture accepts `SESSION_TEST_ORIGIN`, `SESSION_TEST_API` and `SESSION_TEST_COOKIE_NAME` overrides. The full fixture also verifies ordering across participating Reader operations and reports the direct Extension cleanup case below.

## Renewal ordering

Run `node apps/web/tests/fixtures/web-session-cookie/check.mjs` on Node 24 against the built Worker with the fixture API port free. It runs the real renewal client and HTTP handler using a simulated shared cookie jar, Node's Web Locks for participating tabs, and the existing Extension cleanup service for the out-of-lock case. The fixture explicitly checks that direct Extension cleanup can still be overwritten by a delayed response and reports it as deferred.

| Delayed response | Same-tab logout | Other-tab logout | Replacement login | Legacy Extension cleanup |
| --- | --- | --- | --- | --- |
| Original `/v1/user/refresh` | Pass | Pass | Pass | Pass |
| Cookie response delayed before the browser applies it | Pass | Pass | Pass | Deferred (direct Extension cleanup is overwritten) |

A late 401 from the original renewal preserved the replacement session. A focused test also confirmed that queued cleanup rechecks its token and skips a replacement session after taking the lock. The fixture confirmed that logout and replacement login queued behind the in-flight HTTP write. Direct Extension cookie removal can still complete while the writer holds the lock, and a late response can restore that cookie. Its production frequency is unknown.

In the local browser, one top-level Reader tab held the native session lock while a second tab completed the synthetic Google token exchange. The lock manager showed the second tab waiting. Releasing the lock let the real callback write the cookie and navigate to its return page. The fixture used a temporary probe page on the Worker origin. On browsers without Web Locks the previous write behavior still applies.

## Remaining environment checks

- Verify deployed Google and Apple OAuth, the configured Reader callback origin, and HTTPS cookie delivery with test accounts. The fixture uses HTTP on localhost.
- Verify the installed Extension and the iPad Brave report on a deployed test environment. The fixture runs the Extension cleanup code against simulated browser cookie APIs, not an installed Extension.
- Verify ordering on the deployed iPad browser and revisit direct Extension cleanup when the Extension can coordinate with the Reader lock. Full production bookmark and sync smoke flows require the configured backend and were outside the synthetic authentication fixture.
