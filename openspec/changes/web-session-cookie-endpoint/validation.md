# Verification

2026-11-09. The replacement worktree uses `fix/web-session-cookie-endpoint` from `origin/dev` at `228ac3f5`. The requester approved the revised design in conversation. The superseded PR #545 was closed.

## Reproduce locally

Install workspace dependencies and prepare, test and build Web with synthetic runtime values. These values do not contact a real OAuth provider.

```sh
pnpm install --frozen-lockfile
export PUBLIC_BASE_URL=http://localhost:3000
export AUTH_BASE_URL=http://callback.test
export SHARE_BASE_URL=http://localhost:3000
export DWEB_API_BASE_URL=http://127.0.0.1:8787
export COOKIE_DOMAIN=localhost
export COOKIE_TOKEN_NAME=token
export GOOGLE_OAUTH_CLIENT_ID=fixture
export APPLE_OAUTH_CLIENT_ID=fixture
pnpm --dir apps/web run typecheck
pnpm --dir apps/web exec vitest run --maxWorkers 6
pnpm --dir apps/web run build
pnpm exec openspec validate --all --strict
```

Serve the generated Pages artifact from an empty Wrangler working directory. Run the fixture in another terminal.

```sh
cookie_worker_dir=$(mktemp -d /tmp/slax-session-worker.XXXXXX)
WRANGLER_SEND_METRICS=false pnpm --dir apps/web exec wrangler pages dev "$PWD/apps/web/dist" --cwd "$cookie_worker_dir" --port 3000 --ip 127.0.0.1 --compatibility-date 2026-09-02 --compatibility-flags nodejs_compat
node apps/web/tests/fixtures/web-session-cookie/check.mjs --happy-only
node apps/web/tests/fixtures/web-session-cookie/check.mjs
node apps/web/tests/fixtures/web-session-cookie/check.mjs --guarded
```

Use `WEB_SESSION_FIXTURE_ORIGIN` when running the Worker on a different origin. The ordering command currently exits unsuccessfully when it reproduces a stale write. The guarded command is the direct API control.

Run `node apps/web/tests/fixtures/auth-recovery/serve.mjs 44027` for the browser preview. It mounts the real callback page and calls the real Nitro handler through local H3 with synthetic provider responses.

## Results

- The Web suite passed 2,726 tests with 3 skipped. Web typecheck, build, changed-file ESLint and `git diff --check` passed. Strict OpenSpec validation passed all 119 items.
- The generated Pages route manifest includes `/api/auth/session`. The existing `/auth` callback is served from its prerendered client shell outside the Worker route.
- The running Pages Worker exchanged synthetic Google and Apple codes using the configured callback URI, preserved referral, collection and acquisition attribution, forwarded the locale, and returned the existing session cookie and a safe destination. Missing and foreign Origin, non-JSON requests, malformed JSON, a caller-supplied token and invalid upstream tokens were rejected without a cookie. All tested responses carried `Cache-Control: no-store`. A canceled-request unit test also discarded a later upstream success without a cookie.
- The in-app browser preview exercised success, provider rejection, disconnected upstream, fresh provider retry, and the 20-second timeout. The success receipt verified the subsequent browser request included the new session cookie, had cleared the corresponding temporary binding, and reached the requested destination. A second browser run used the final Pages build on localhost port 3311. The static callback completed synthetic OAuth, redirected to /guide, and the normal startup renewal used the same endpoint. The next browser request carried the renewed cookie.
- The running Worker renewed the shared cookie with 204 and an empty body. Unit tests cover a request-cookie mismatch, wrong-account output and 401 responses without a cookie. The Mobile subscription route retains direct renewal in the store test.
- The ordering fixture used the production renewal client and a simulated browser cookie jar. The guarded direct control passed all five cases. It used the installed Extension's current `SessionService.clearSession()` implementation with a simulated browser cookie API.

| Change while renewal is pending | HTTP candidate |
| --- | --- |
| Logout in the renewing tab | The pending request was canceled and the cookie stayed absent |
| Logout in another tab | A late 204 restored the cleared cookie |
| Replacement OAuth login | A late 204 overwrote the replacement cookie |
| Existing Extension cleanup | A late 204 restored the cleared cookie |
| Replacement login before an old 401 | The replacement cookie survived |

## Review

- Bugs. A same-tab logout cancels pending Web renewal. Cross-tab logout, replacement login and independent Extension cleanup can still be overwritten by a late HTTP response. The candidate remains a draft for the ordering gate.
- Security. The client callback can only finish an attempt matching its temporary cookie, and the endpoint independently enforces that binding. The endpoint fixes the upstream path, rejects redirects and forwards an allowlist of browser event headers. Its response omits the token body and rejects invalid issued tokens before writing a cookie. The JSON request uses CORS mode and omits the callback referrer. The renewal branch matches the starting Bearer to the request cookie and confirms the result account.
- Compliance. The requester authorized the login and renewal candidate and requested restoration of the previous callback rendering configuration. The Pages configuration adds only the new API route. No Extension, Mobile or CLI package code or output changed.

## Remaining coverage

- Real Google and Apple callbacks and the production alias, Cloudflare IP and geographic attribution, and bookmark access require a deployed Reader test environment. The synthetic fixture validates application attribution payloads. It cannot establish Cloudflare subrequest metadata or production callback registration.
- A real installed Extension, iPad Brave reopen and inactivity, and the Android handoff on a device have not been exercised. Android routing has automated coverage. The shell-launched Chrome matrix could not start Chrome in this environment, so the core callback scenarios were exercised in the in-app browser instead.
- HTTP renewal is available in the review candidate. The release task remains open because the ordering fixture reproduces three stale writes. A request-time Bearer and cookie comparison cannot protect against changes made after the request starts.
