# Validation

Worktree: `.local/server-set-session-cookie-worktree`, branch `fix/server-set-session-cookie`, based on `origin/dev` at `b6210fe7`. Commands ran with placeholder public Web settings from `deploy/local/.env.web.example` (`COOKIE_DOMAIN=localhost`, `COOKIE_TOKEN_NAME=slax_test`, dummy OAuth client ID); no secret files were used.

## Automated checks

| Command | Result |
| --- | --- |
| `pnpm web -- test` | Passed: 232 files, 2,718 tests (3 skipped), including `tests/unit/server/authSession.spec.ts` |
| `pnpm web -- typecheck` | Passed |
| ESLint on the changed files | Passed |
| `pnpm web -- lint` | Fails with 89 `simple-import-sort/imports` errors in unchanged files; the same errors occur without this change |
| `pnpm web -- build` | Passed; `dist/_routes.json` includes `/api/auth/session` |
| `openspec validate --all --strict` | Passed |

## Running environment

`node apps/web/config/wrangler-command.mjs ssr-dev` built the Web app and served it with `wrangler pages dev`. A local mock API on `127.0.0.1:8799` returned synthetic JWT-shaped tokens for login, refresh, and profile reads. Headless Chrome (playwright-core with the installed Chrome) used a fresh profile per scenario.

HTTP probes against the worker:

- Same-origin JSON: `204`, `Cache-Control: no-store`, `Set-Cookie: slax_test=<token>; Max-Age=5184000; Domain=localhost; Path=/; SameSite=Lax`.
- Cross-site Origin, missing Origin, and a same-origin `text/plain` body: `400`, no cookie.

Browser scenarios:

1. Login reached `/bookmarks`. The endpoint returned `204` with `Set-Cookie` for the login token, then for the refreshed token from the automatic daily refresh. The final cookie held the refreshed token, expired in 60 days, was `SameSite=Lax`, and not `HttpOnly`. Logout from the user menu reached `/login` and removed the cookie.
2. With the login write forced to `403`, `503`, or a network failure, login still reached `/bookmarks`; before the refresh write, the script-written cookie held the login token with a 60-day expiry.
3. With the refresh write forced to `500`, the cookie kept the login token.

Temporary servers and scripts were stopped and deleted; the worktree contains only the change's files.

## Review

The `REVIEW.md` Bugs, Security, and Compliance passes ran on the final diff before pushing, with no Important findings.

## Not verified

- WebKit lifetime: Chrome does not apply WebKit's script-cookie caps. A Safari check on beta (task 2.4) must confirm a 60-day expiry after a real Google login.
- Cloudflare security rules on `POST /api/auth/session` (task 2.3), which require a deployed beta.
- Real Google OAuth and the real API: the API was mocked because local API secrets are not available to the worktree.
- The Extension was not run. It reads the cookie with `browser.cookies.get` by the unchanged name, domain, and path.
