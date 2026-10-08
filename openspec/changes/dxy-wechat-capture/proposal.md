## Why

DXY WeChat article pages load their body with JavaScript. Add URL currently downloads the initial HTML shell and can save an empty title and loading UI as successful content. Port the fix already reviewed in legacy backend PRs #867 and #868 to the consolidated API.

## What Changes

- Request rendered browser HTML for `wechat.dxy.cn` through both existing regular-page fetch providers.
- Centralize the existing browser-host policy using exact host or dot-delimited subdomain matching.
- Reject empty-title results consisting only of recognized short loading/dialog UI before successful content writes.
- Port parser and hostname regression tests and verify provider fallback behavior in the monorepo.

## Capabilities

### New Capabilities

- `dynamic-article-capture`: Render supported dynamic article pages and reject known loading placeholders.

### Modified Capabilities

None.

## Impact

Only `apps/api` crawl selection, regular-page parsing, and their tests change. No frontend, database schema, API contract, provider credentials, or deployment changes are required. Existing saved empty bookmarks are not automatically repaired. The user's request to synchronize the previously reviewed fix establishes the migration scope.
