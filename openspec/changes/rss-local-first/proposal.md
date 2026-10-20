# Proposal

## Why

RSS in Web and the native app is REST-only with an in-memory, 60-second session cache: a cold start or an offline session shows no subscriptions or articles, and every source switch waits on the network. The rest of the reader (bookmarks, tags, collections) is already local-first through PowerSync, so RSS is the one list that does not open instantly or work offline.

## What Changes

- Sync RSS list metadata through PowerSync for clients that opt in: the user's own subscriptions, metadata of their subscribed feeds, and each feed's latest-page entries. Article HTML, fetch internals and history pages are not synced.
- Add an on-demand `rss_v1` Sync Stream. Only new Web and native clients subscribe to it, and only while the RSS laboratory is enabled; the stream itself also requires the laboratory and an active account, so disabling RSS removes the data from every client.
- Persist the signed favicon proxy URL on the shared feed and mark entries that were fetched from history pages, so the synced window stays bounded to the latest pages.
- Skip shared entry rewrites when a refreshed item is unchanged, so a source that always returns HTTP 200 does not push redundant changes to every subscriber.
- Add an optional `before` entry id to `GET /v1/rss/entries` so a client that renders its list from local data can continue pagination (and explicit history loading) after its last local entry.
- Web and native read subscriptions and the latest entries from the local database and derive display names, refresh state and saved state locally. All writes (add, rename, remove, refresh, save), article detail and history loading keep using the existing REST endpoints. Web keeps the current REST path when PowerSync is unavailable.
- Existing clients and the existing collection and bookmark streams are unaffected; `schema_version` stays `2`.
- Admit the current SDK's native-created format-14 databases with `user_version=0`, while retaining the strict `user_version=1` requirement for Kotlin adoption and the existing ownership and exact-table checks. This allows a fresh native client to reach its first RSS synchronization.
- Remove the empty native RSS source-action toolbar in the All view so the first article follows the source strip with normal row spacing. A selected source retains its refresh and menu controls.
- Complete the Web validation dependency by narrowing runtime cookie names, domains and token values at shared cookie boundaries, preserving ordinary authentication and notification behavior while rejecting invalid values safely.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rss-labs`: the Web session-only list cache becomes a persisted local list on clients with local storage; adds a requirement for local-first RSS list data on Web and native, including laboratory gating, account isolation and the bounded synced window; history loading may continue from a local entry.

## Impact

- **API (`apps/api`)**: one PostgreSQL migration (`sr_rss_feed.icon_url`, `sr_rss_entry.is_history`), `RssRepo`/`RssService` write paths, `before` query support, tests. No new endpoints and no change to the sync upload path.
- **PowerSync config**: `deploy/local/powersync-local/sync_rules.yaml` gains the `rss_v1` stream; production Sync Config must be updated the same way, and the replication publication must include the `sr_rss_*` tables.
- **Contracts (`packages/contracts`)**: optional `before` in `RssEntriesQuery`.
- **Web (`apps/web`)**: local schema tables, a local RSS query composable, a local mode in `useRss`, and a shared checked cookie boundary used by authentication and notifications so the application typecheck passes.
- **Mobile (`apps/mobile`)**: local schema tables, installation schema validation that accepts databases created before the RSS tables existed, a local RSS repository and controller changes. This changes shipped Mobile behavior, so a Mobile version decision is required before release.
- **Rollout order**: migration and API, then Sync Config, then clients.
