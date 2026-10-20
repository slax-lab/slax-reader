# Tasks

## 1. API data model and write paths

- [x] 1.1 Add `sr_rss_feed.icon_url` and `sr_rss_entry.is_history` to `pgsql.prisma`, generate and review the migration, and regenerate with `pnpm api -- gen:all`; verify that replaying all migrations into an empty database yields no drift and that `migrate deploy` applies cleanly.
- [x] 1.2 Mark history inserts with `is_history = true`, reset it on latest-page upserts, and skip unchanged upserts with `IS DISTINCT FROM`; verify with repository tests on embedded PostgreSQL.
- [x] 1.3 Persist the signed favicon proxy URL on successful add, refresh and `304`; verify with service and repository tests.
- [x] 1.4 Accept `before=<entry id>` on `GET /v1/rss/entries` with ownership checks, include newer history rows on that first page, return `sort_at` on list items, and add `before`/`sort_at` to the contracts; verify cross-feed ordering on embedded PostgreSQL, unauthorized ids, and `before` with `fetch_history=1` with tests.

## 2. Sync Config

- [x] 2.1 Add the `rss_v1` on-demand stream to `deploy/local/powersync-local/sync_rules.yaml` and extend `powersyncRules.test.ts` (laboratory join, per-user subscriptions, latest-page entries, no connection-parameter `IN`); verify the test passes.
- [x] 2.2 Run the stream against an isolated local PowerSync service with the real migrated schema; verify owner-only subscriptions, shared feeds, excluded history rows and removal when the laboratory is disabled.

## 3. Web

- [x] 3.1 Add the three RSS tables to the Web PowerSync schema without changing the local data version; verify `pnpm --filter ./apps/web typecheck`.
- [x] 3.2 Add a local RSS query composable that maps rows to the existing RSS contract types, including display names, refresh state and saved state; verify with unit tests.
- [x] 3.3 Add local mode to `useRss` (stream subscription, first-sync gating, overlays for confirmed writes, `before` pagination) and keep the REST mode unchanged when PowerSync is unavailable; verify with `useRss` and `RssPanel` tests.

## 4. Native

- [x] 4.1 Add the three RSS tables to the mobile schema and split legacy and current storage-table sets so existing installations open without recovery; verify with installation and adoption tests.
- [x] 4.2 Add a local RSS repository and switch the RSS controller list reads to local data with the stream subscription, first-sync gating, overlays and `before` pagination; verify with controller tests.

## 5. Verification and delivery

- [x] 5.1 Run API, Web and Mobile tests and typechecks and `openspec validate --all --strict`; record pre-existing failures separately.
- [x] 5.2 Run the REVIEW.md pre-push review and resolve Important findings.
- [x] 5.3 Record the production Sync Config and publication checklist and the explicit Mobile version decision in `delivery.md` for the PR handoff.

## 6. Review follow-ups

- [x] 6.1 Give the native saved-URL join explicit TEXT affinity so SQLite can index the aggregate instead of scanning it per RSS row; verify the query plan and compare representative query timings.
- [x] 6.2 Read admitted native RSS caches before stream readiness, validate Labs in the background without blocking cached navigation, and discard late results on cancellation/account replacement; verify offline, pending-sync and confirmed-disable scenarios.
- [x] 6.3 Retire already-synced write overlays immediately on Web and native, including reader save notifications; verify sync-before-REST followed by bookmark/subscription deletion and already-settled refreshes.
- [x] 6.4 Make Web rename overlays yield to later synced remarks and handle sync-before-REST on both clients; verify source labels and other subscription metadata remain current.
- [x] 6.5 Bound Web entry mapping to the selected source and visible local page plus one look-ahead row, use indexed native overlay lookups, and avoid counting the entire subscription table for cache presence; verify pagination and source switching.
- [x] 6.6 Have a small-model agent add and execute regression tests and run the relevant application checks; record results and native-device limitations.

## 7. Complete the remaining verification

- [x] 7.1 Fix the shared Web cookie/runtime-config type boundary without unsafe casts, preserve valid authentication and notification behavior, and have a small-model agent run Web typecheck and regression suites to completion.
- [x] 7.2 Have a small-model agent execute isolated RSS native acceptance on exactly one task-owned iOS simulator, without running Android, and record the exact runtime, checks, outcomes and any environmental constraints.
- [x] 7.3 Record the explicit Mobile version decision and, if an increment is approved, update version/build metadata through the existing regeneration tooling and verify it with a small-model agent. The human explicitly requested keeping `1.0.25`, build `771`, previous build `770`; release version assignment will be decided later in the task sequence.
- [x] 7.4 After recording results, remove all task-created simulators, build caches, exported applications and temporary verification artifacts; retain only source changes and durable verification summaries, without touching other tasks' state.

## 8. Real local RSS synchronization acceptance

- [x] 8.1 Add a reproducible task-owned local PostgreSQL and PowerSync harness using the migrated schema and this branch's actual Sync Config, with synthetic server-side accounts and RSS data and no operator credentials or shared-service mutations.
- [x] 8.2 Have `gpt-6-luna high` verify actual `rss_v1` delivery into initially empty native RSS tables on exactly one iOS simulator, including ownership, shared feeds, history exclusion, server updates and Labs removal/restoration.
- [x] 8.3 Verify offline cold relaunch and subsequent reconnect convergence on that same simulator; record real transport, checkpoint, database and visible UI evidence separately from the earlier seeded fixture run.
- [x] 8.4 Admit the real SDK's native-created `user_version=0` database on fresh and initialized startup without changing the strict Kotlin-adoption profile, ownership checks or table validation; verify rejected unknown profiles and repeat native acceptance on the same untouched database.
- [x] 8.5 Remove the native All view's empty 48-point source-action toolbar and verify compact first-row spacing plus selected-source refresh/menu access on the same iOS simulator.
- [x] 8.6 Review the added harness and results, preserve the explicit version decision, validate OpenSpec, and remove all resources, simulators, caches and temporary artifacts created by this acceptance run after recording durable evidence.

## 9. Local list startup correction

- [x] 9.1 Keep owned local RSS clients in a loading state until first synchronization and local queries complete; initialization, selection and polling must not fetch REST subscription or entry lists merely because synchronization is pending.
- [x] 9.2 Remove REST entry-list seeding after a confirmed subscription add in local mode; publish the subscription overlay and obtain its latest entries through synchronization. Preserve explicit REST history and unavailable-storage fallback.
- [x] 9.3 Have `gpt-6-luna high` add and execute regressions for pending synchronization, cached startup, subscription additions, explicit history and genuine fallback, and run affected typechecks; record results and clean only new task-owned outputs.
- [x] 9.4 Cache the Labs response for the current browser account, coalesce concurrent page consumers, reject late responses from a replaced account, and refresh explicitly in settings without polling Labs from RSS.
- [x] 9.5 Confirm the actual local service ACTIVE Sync Config includes `rss_v1`, then inspect the authenticated Web page and measure request counts across initialization, source changes and a full automatic-check interval; preserve existing browser data and local configuration.
- [x] 9.6 Diagnose the deployed test environment's missing article rows, attempt isolated service reproduction with a small-model agent, verify recovery against the actual remote stream, and document the evidence and limits without resetting client or source databases; remove all new task-owned service resources.
