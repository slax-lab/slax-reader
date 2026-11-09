# Collection analytics runtime fixtures

This manual smoke uses the real Nuxt pages, OAuth callback, request helpers, and modal factory. A local Worker supplies collection content. Playwright intercepts Google and browser API responses, including legacy `/m` and the cookie writer response; these are synthetic accounts and credentials, not real authentication or warehouse evidence. Keep the fixture backend on localhost. Chrome and the existing `@nuxt/test-utils` Playwright dependency are required. No new dependency is installed.

From the repository root, start the content fixture in one terminal:

```sh
touch /tmp/slax-collection-empty.txt
collection_fixture_config="$PWD/apps/web/tests/fixtures/collection-analytics/wrangler.jsonc"
WRANGLER_SEND_METRICS=false pnpm --filter slax-reader-backend exec wrangler dev --config "$collection_fixture_config" --port 8799 --env-file /tmp/slax-collection-empty.txt --persist-to /tmp/slax-collection-state
```

Start an isolated Web dev port in a second terminal. These values are public local placeholders:

```sh
PUBLIC_BASE_URL=http://localhost:3215 AUTH_BASE_URL=http://localhost:3215 SHARE_BASE_URL=http://localhost:3215 DWEB_API_BASE_URL=http://localhost:8787 COOKIE_DOMAIN=localhost COOKIE_TOKEN_NAME=slax_test GOOGLE_OAUTH_CLIENT_ID=fixture-client APPLE_OAUTH_CLIENT_ID=fixture-apple BACKEND_SERVICE_NAME=slax-collection-fixture pnpm web -- dev --port 3215
```

Run the browser and query fixtures:

```sh
node apps/web/tests/fixtures/collection-analytics/browser-check.mjs
python3 apps/web/tests/fixtures/collection-analytics/query-fixture.py
```

The browser verifies usable SSR/hydration opens, pagination, collection changes, re-entry, reload, closed/missing pages, modal dismissal/reopening, one Google click, callback provenance, same-origin device continuity, and automatic subscription without an extra click. It asserts no client success facts and no browser errors. It does not verify real Google authorization, cross-origin cookie continuity, server ingestion, or database writes; API tests cover server outcomes separately.

The in-memory SQLite query fixture verifies the approved 48-hour and 30-minute boundaries, natural-key redelivery deduplication, repeated visits, new/returning authentication, immature entries, and exclusion of authenticated/Inbox/legacy/missing-device entries from the anonymous public cohort. The separate first-click fixture also verifies click-time identity, first versus last click, required public predecessors, matching devices/collections, report boundaries, already-converted immature entries, zero denominators, and duplicate replay. Its independent expected mature cohort is 8 anonymous browsers / 3 conversions and 1 authenticated browser / 1 conversion. It is a hand-checked metric fixture, not the production warehouse query or a replacement for bot filtering and snapshot evidence.

Stop both processes after verification. The Web binding projection is generated from the fixture override; later normal Web setup/dev regenerates its ordinary local bindings. No tracked application configuration is edited by this setup.
