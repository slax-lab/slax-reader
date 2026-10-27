# Validation

Date: 2026-10-28.

## Baseline

Executing the archive action from `origin/dev` with a successful server response changed its reader state but emitted zero notifications. The new notification expectation fails against that baseline.

Before the fix, the list regressions failed for archive removal, foreground recovery, and local query refresh. A separate regression exposed a foreground return during an earlier refresh. It failed before the follow-up request was retained.

## Automated checks

The checks use synthetic public configuration:

```sh
export PUBLIC_BASE_URL=https://reader.test
export AUTH_BASE_URL=https://auth.test
export COOKIE_DOMAIN=reader.test
export COOKIE_TOKEN_NAME=slax-token
export SHARE_BASE_URL=https://reader.test
export DWEB_API_BASE_URL=https://api.test
export GOOGLE_OAUTH_CLIENT_ID=test-client
```

- `pnpm --filter @apps/slax-reader-dweb test`: 2,567 tests passed; three tests were skipped. The run passed 226 files and skipped one file.
- `pnpm --filter @apps/slax-reader-dweb typecheck`: passed. The final source also passed `pnpm --filter @apps/slax-reader-dweb exec vue-tsc --noEmit -p .nuxt/tsconfig.app.json` after Nuxt preparation.
- ESLint passed for the four changed runtime files and three test files. It reported the existing `no-explicit-any` warning in `loadData`; no errors occurred.
- `pnpm exec openspec validate --all --strict`: 79 items passed, zero failures.
- `git diff --check`: passed.

The 23 new regressions cover REST and local archive notifications, unarchive, failed writes, account changes, cached-page activation, hidden tabs, and duplicate foreground events. They also cover loaded pages, failed refreshes, obsolete filter responses, concurrent archive actions, and highlight-query isolation. Local query tests verify that refresh does not write archive state or query the server. Concurrent delete, title, and star actions also invalidate older refresh responses.

## Running browser exercise

Command:

```sh
node apps/web/tests/fixtures/20261028-archive-browser.mjs
```

The fixture bundles the production bookmark-list composable, archive action, and message channel. It uses isolated Chrome tabs and a local HTTP server with synthetic bookmarks. It does not use a production account. Local database modules are outside this REST fixture.

Chrome `156.0.8078.48` passed these checks:

1. Load 40 bookmark rows and scroll the Inbox.
2. Open another tab, archive the first article, close that tab, and return.
3. Confirm that the article disappears, 40 rows remain loaded, and the visible article anchor stays at the same position.
4. Unarchive in another tab and confirm that the article returns.
5. Change the server state without a notification, then exercise foreground recovery.
6. Return HTTP 503 for a refresh and confirm that the list remains visible.
7. Restore the server and confirm that the next foreground check recovers.

The fixture reported `PASS` and zero page errors. Initial and final scroll offsets were both 450 pixels. Chrome adjusted the intermediate offset when it removed a row above the viewport; the visible anchor stayed fixed. The deliberate HTTP 503 produced the expected browser resource error.

Headless Chrome can keep every tab visible. The missed-message check explicitly dispatches `visibilitychange` after closing the other tab. This exercises the production listener but does not establish native background behavior on Safari.

## Review

The local review covered the Bugs, Security, and Compliance passes in `REVIEW.md`. No Important findings remain. The fix uses the existing account-key helper and sends no token or article content. Refreshes only read data. Obsolete responses cannot replace a later account or filter. No other active change owns the `web-local-sync` delta.

## Limits and acceptance

- A production account and remote PowerSync service were not used. Real synchronization latency and Safari/mobile worker behavior remain unverified.
- The browser fixture exercises production data-flow code with a synthetic UI. It does not establish full-page visual or theme acceptance.
- This change adds no layout, style, icon, label, or accessibility changes. Theme screenshots are not claimed.
- Human hands-on acceptance is pending. No pull request will open before that acceptance is recorded.
- The task affects Web only. The CLI, Extension, and Mobile version-decision rule does not apply.
- The commit is local. This validation does not claim deployment or production recovery.
