# Verification

2026-11-09. Work was isolated in `fix/set-web-session-cookie-via-proxy`, initially based on `e1fa706f` and fast-forwarded to `origin/dev` at `4d6225d2` for pre-PR review. The requester approved narrowing the candidate to HTTP Cookie issuance at sign-in and direct API renewal with the existing browser write guard.

## Reproduce locally

Build the Web app with synthetic configuration. The callback host intentionally differs from the Reader host so the test can check which URI reaches the API.

```sh
PUBLIC_BASE_URL=http://localhost:3000 AUTH_BASE_URL=http://callback.test SHARE_BASE_URL=http://localhost:3000 DWEB_API_BASE_URL=http://127.0.0.1:8787 COOKIE_DOMAIN=localhost COOKIE_TOKEN_NAME=token GOOGLE_OAUTH_CLIENT_ID=fixture APPLE_OAUTH_CLIENT_ID=fixture pnpm --dir apps/web run build
```

In one terminal, serve that Pages artifact with the installed Wrangler. The temporary working directory avoids loading deployed service bindings.

```sh
cookie_worker_dir=$(mktemp -d /tmp/slax-cookie-worker.XXXXXX)
pnpm --dir apps/web exec wrangler pages dev "$PWD/apps/web/dist" --cwd "$cookie_worker_dir" --port 3000 --ip 127.0.0.1 --compatibility-date 2026-09-02 --compatibility-flags nodejs_compat
```

In another terminal, run the fixture. It starts a synthetic API on port 8787. It runs the production account-locale client and renewal task against the synthetic API. Its Cookie jar models the browser applying headers and independent Cookie removal. Web logout is modeled as Cookie removal. The Extension case invokes the existing `SessionService.clearSession()` with a test implementation of the browser Cookie API.

```sh
node apps/web/tests/fixtures/web-session-cookie/check.mjs
```

## Candidate results

- The final Web Pages build completed. The generated `dist/_routes.json` includes `/auth` and omits the prototype renewal path. There is no prerendered `auth.html`.
- The Wrangler Worker fixture passed both provider exchanges, non-cacheable `302` responses, session Cookie issuance, the registered callback URI, referral and attribution forwarding, and failed Apple recovery. Normal renewal contacted the existing API and rotated the Cookie through the guarded client path.
- All delayed-renewal cases passed.

| Operation before renewal finishes | Cookie after the old response |
| --- | --- |
| Simulated Web logout Cookie removal | Absent |
| New account B login through the Worker | Account B |
| Existing Extension cleanup through a test Cookie API | Absent |
| New account B login before the old renewal returns 401 | Account B |

- Web application typecheck, final Pages build, changed-file ESLint and `git diff --check` passed. The final scoped Web suite passed 162 tests. The preceding full Web run passed 2,706 tests with 3 skipped. Strict OpenSpec validation passed 118 items.
- Independent review confirmed the direct renewal implementation and package sources match the base branch. Follow-up checks preserve configured URL path prefixes and remove a distinct legacy explicit current-host Cookie when issuing a canonical parent-domain Cookie. Unit coverage exercises both cases.

## Pre-PR review

- **Bugs.** An interrupted request previously left the local callback waiting for the API. The Node fixture reproduced that failure and verified that closing the response connection now cancels the pending fetch. An isolated request-signal test confirms that a late upstream success after cancellation issues no session Cookie and no success redirect. The Pages Worker continued to pass normal login and renewal tests. A disconnected-client probe through local Wrangler did not observe upstream cancellation within two seconds, even with `enable_request_signal`. Repeat that case on the deployed Pages Worker.
- **Bugs.** An Android deep-link navigation rejection could leave the callback loading. The callback now restores its existing recovery state when navigation rejects. A unit test fails without the fix and passes with it.
- **Bugs and Security.** OAuth state generation uses `getRandomValues()` so it can run on supported browsers that lack `randomUUID()`. A compatibility test disables the newer API and verifies that authorization still starts with a bound nonce. Locale selection no longer generates an unrelated device ID as a side effect. The fixed API target, redirect rejection, Cookie scope and no-cache behavior were rechecked.
- **Compliance.** Review is tied to `set-web-session-cookie-via-proxy`. The prior Web callback displayed a page-level spinner during code exchange. The HTTP callback waits for the initial response and then redirects to success or the existing recovery view. This visible change requires human hands-on acceptance under `DESIGN.md` §10.2 before the PR opens. Web and API changes have no package-version decision under the repository's versioning policy. The candidate changes no Extension, Mobile or CLI package code or output.

## Superseded prototype

The previous HTTP renewal prototype passed normal login and renewal, then failed all three delayed-success cases. Its response restored account A after Web logout and Extension cleanup and overwrote a new login for account B. The candidate removes the Nitro renewal route and restores the original application renewal code. The checked request's Cookie and Bearer described the dispatch-time state. They could not guard a later browser Cookie write.

## Browser smoke

Run `node apps/web/tests/fixtures/auth-recovery/serve.mjs 44020` and open `http://127.0.0.1:44020/`. The browser exercise used the actual callback handler and recovery page with synthetic providers. The provider-error case showed persistent recovery, the retry reached a fresh local authorization receipt, and successful login returned to the configured target. A timed request to the running callback returned timeout recovery after 20 seconds without issuing a session Cookie. The local smoke uses disposable fixture data.

## Human hands-on acceptance

On 2026-11-09, the requester exercised the local `disconnect` and `provider-error` scenarios and reported a Vite error. The preview process was still running the previous import transform. Restarting it from the reviewed commit resolved the duplicate import. Browser smoke then confirmed that both scenarios show the existing recovery prompt and that the Google action starts a fresh simulated authorization. The requester confirmed the preview looked correct and approved opening the PR. No product code adjustment was needed for the preview process issue.

## Remaining environment coverage

- Real Google and Apple sign-in, the callback alias redirect, Cloudflare IP and geographic attribution, and bookmark access need a deployed test Worker and disposable accounts.
- A real installed Extension, iPad Brave reopen or inactivity, and the Mobile subscription WebView have not been exercised on their target devices. The local timing fixture uses the Extension source and a test Cookie API. The full Chrome browser matrix and collection analytics browser smoke have not been rerun in a shell-launched browser.
- The shared REST request and PowerSync authorization handlers were outside this change. The old renewal 401 case exercises the account-locale client and its existing protection only.
