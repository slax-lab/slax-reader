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
node apps/web/tests/fixtures/web-session-cookie/check.mjs
```

Run `node apps/web/tests/fixtures/auth-recovery/serve.mjs 44027` for the browser preview. It mounts the real callback page and calls the real Nitro handler through local H3 with synthetic provider responses.

## Results

- The Web suite passed 2,722 tests with 3 skipped. Web typecheck, build, changed-file ESLint and `git diff --check` passed. Strict OpenSpec validation passed all 119 items.
- The generated Pages route manifest includes `/api/auth/session` and `/auth`. The callback is not prerendered. The running Pages Worker serves `/auth` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- The running Pages Worker exchanged synthetic Google and Apple codes using the configured callback URI, preserved referral, collection and acquisition attribution, forwarded the locale, and returned the existing session cookie and a safe destination. Missing and foreign Origin, non-JSON requests, malformed JSON, a caller-supplied token and invalid upstream tokens were rejected without a cookie. All tested responses carried `Cache-Control: no-store`. A canceled-request unit test also discarded a later upstream success without a cookie.
- The in-app browser preview exercised success, provider rejection, disconnected upstream, fresh provider retry, and the 20-second timeout. The success receipt verified the subsequent browser request included the new session cookie, had cleared the corresponding temporary binding, and reached the requested destination.
- The Pages fixture exercised the production guarded renewal task with a synthetic API and browser cookie jar. An earlier response did not restore a cookie cleared by Web logout or the existing Extension's `SessionService.clearSession()`, replace a newer OAuth login, or clear the replacement account after a late 401. The Extension source used a simulated browser cookie API.

## Review

- Bugs. The route guard now lets callbacks with a code run even when a session already exists. Existing redirect-only sign-in return paths, including KOC invitations, keep their behavior. Tests cover both cases.
- Security. The client callback can only finish an attempt matching its temporary cookie, and the endpoint independently enforces that binding. The endpoint fixes the upstream path, rejects redirects and forwards an allowlist of browser event headers. Its response omits the token body and rejects invalid issued tokens before writing a cookie. The callback supplies an explicit CORS-mode same-origin request so the browser supplies Origin while the callback suppresses Referer.
- Compliance. The diff implements the approved `web-session-cookie-endpoint` login phase. The recovery layout and controls are unchanged. No Extension, Mobile or CLI package code or output changed.

## Remaining coverage

- Real Google and Apple callbacks and the production alias, Cloudflare IP and geographic attribution, and bookmark access require a deployed Reader test environment. The synthetic fixture validates application attribution payloads. It cannot establish Cloudflare subrequest metadata or production callback registration.
- A real installed Extension, iPad Brave reopen and inactivity, and the Android handoff on a device have not been exercised. Android routing has automated coverage. The shell-launched Chrome matrix could not start Chrome in this environment, so the core callback scenarios were exercised in the in-app browser instead.
- The HTTP refresh action is gated. The passing ordering fixture covers the existing guarded Web write. In the superseded prototype, applying a successful renewal response over HTTP reproduced session restoration after Web logout and Extension cleanup and replacement of a newer login. The server's request-time bearer and cookie comparison cannot protect a later browser write. A candidate HTTP renewal must pass the same ordering cases before switching the Web caller.
