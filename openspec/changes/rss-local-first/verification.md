# Verification evidence

Date: 2026-10-20. Host checks ran locally against the `feat/rss-local-first` worktree. No production services or credentials were used, and no production migration or deployment was performed. Android simulator and physical-device acceptance were not run. The earlier seeded single-iOS-simulator run is recorded in `native-verification.md`; the subsequent real local sync run is recorded in `real-sync-verification.md`.

Both test agents used `gpt-6-luna` with `high` reasoning to add and execute the regression tests, application checks and iOS acceptance. Follow-up tests retain that configuration, as explicitly requested by the human. The implementation agent reviewed the resulting tests and corrected cases that could mask the original defect.

## Regression coverage

The focused native RSS suites passed with 35 tests across `apps/mobile/tests/rss/controller.test.mjs` and `apps/mobile/tests/data/rss.test.ts`. Added cases cover admitted-cache rendering while Labs and first stream sync are pending, source selection before sync, offline Labs failure, confirmed disable, stale disable after cancellation/disposal/account replacement, sync-before-REST saves and reader save events followed by bookmark deletion, rename races, add/delete races, settled refresh races, watcher setup fallback, a real SQLite cache-presence query, and SQLite saved-URL query-plan and result equivalence.

The focused Web RSS suites passed with 28 tests across `apps/web/tests/unit/composables/rss/*.spec.ts`. Added cases cover sync-before-REST save/delete and rename races, later remarks winning whether or not the intermediate rename sync is observed, add sync followed by an external deletion, settled refresh, selected-window mapping, filtering before the 50-row cap, and all-view removal where later sources remain visible and paginate locally.

The API RSS domain and PowerSync rule suites passed with 106 tests: `test/domain/rss` and `test/infra/powersyncRules.test.ts`.

## SQLite plan and timing evidence

The native test runs the repository's actual `watchEntries` SQL and compares it with the previous query after removing the `CAST(... AS TEXT)` from the saved URL CTE. For each workload, both queries return identical rows. The current query plan searches the materialized saved rows through an automatic covering index; the previous plan scans those rows for each join.

The changed SQL expression is:

```sql
-- Previous
json_extract(metadata, '$.bookmark.target_url') AS url

-- Current
CAST(json_extract(metadata, '$.bookmark.target_url') AS TEXT) AS url
```

The serial benchmark command was `node --experimental-strip-types --test --test-name-pattern="RSS saved URL join plan" apps/mobile/tests/data/rss.test.ts`. It ran after the other test suites had finished, on Node v22.22.3, macOS arm64, SQLite 3.51.3:

| RSS entries | Live bookmarks | Previous query | Current query |
| ---: | ---: | ---: | ---: |
| 1,000 | 1,250 | 80.44 ms | 7.80 ms |
| 2,000 | 2,500 | 318.86 ms | 20.88 ms |
| 4,000 | 5,000 | 1,103.54 ms | 25.73 ms |

These timings are informative local SQLite measurements, not a native-device performance claim. The plan still materializes and groups bookmark rows and sorts the final RSS window.

## Application checks

- `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- check` passed with exit code 0, including TypeScript checking and 1,319/1,319 host tests. The final run includes the stable native fixture identity, persistent RSS database, and generated-source-digest assertions. The check reported native parity as unverified, as expected without device execution; one separate iOS simulator acceptance run is documented in `native-verification.md`.
- After the final fixture-control `--port`/origin templating, generator whitelist, and Library All-action corrections, `SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- typecheck` passed with exit code 0. The focused fixture tooling command `node --test apps/mobile/tests/ui/fixture-control-contract.test.mjs apps/mobile/tests/data/fixture-project.test.mjs apps/mobile/tests/data/prepare-rss-native-fixture.test.mjs` passed all 9 tests (0 failed). The typecheck pre-hook generated `apps/mobile/assets/pdf/bundle.json`; it was removed after verification.
- `pnpm mobile -- bundle` passed and exported iOS (1,846 modules) and Android (1,843 modules) bundles.
- `pnpm --filter ./apps/web exec vitest run tests/unit/composables/useRss.spec.ts tests/unit/components/RssPanel.spec.ts` passed: 23 tests across the REST fallback composable and RSS panel consumer suites.
- The focused Web auth/session/notification suites passed 124 tests across `useAuth.spec.ts`, `useNotification.spec.ts`, `stores/user.spec.ts`, and `utils/request.spec.ts`. They cover valid raw string tokens, rejecting non-string token values, invalid cookie-name handling, required login-cookie persistence, and reuse of the captured locale cookie handle.
- `pnpm --filter ./apps/web exec vitest run --maxWorkers=1 tests/unit/middleware/auth.global.spec.ts` passed 13 tests. The test harness now preserves the real `@commons/frontend-utils/is` exports and returns no navigation target during Nuxt startup.
- The combined Web RSS local, REST fallback, and panel consumer run passed 51 tests across `tests/unit/composables/rss`, `useRss.spec.ts`, and `RssPanel.spec.ts`.
- `pnpm --filter ./apps/web typecheck` passed with explicit exit code 0. The ten TS2345 diagnostics encountered earlier in this task are resolved by validating the shared cookie-name/value boundary and the notification push-key type.
- ESLint passed on the changed Web source and test files with exit code 0; it reported eight `no-explicit-any` warnings in `useNotification.spec.ts` and `request.spec.ts` (their baseline was not measured separately).
- `pnpm --filter slax-reader-backend typecheck` passed.
- `pnpm exec openspec validate --all --strict` passed all 54 items. It printed existing informational long-requirement notices and an archive warning for the unrelated `youtube-ai-article` delta; no validation item failed.

The first Web typecheck attempt exposed ten TS2345 diagnostics caused by unknown cookie/config values. The shared cookie boundary and affected call sites were corrected in this task; the final official Web typecheck completed cleanly.

After the native fixture follow-ups, the small-model agent reran Mobile typecheck successfully and the latest focused fixture-tool suite passed 10/10. This final narrow pass covers the prepared Scene configuration, isolated control identity and port, and generated input digests. The single-simulator UI, cold-relaunch and local bookmark-deletion results, including their synthetic transport boundary, are recorded in `native-verification.md`.

The later real-sync follow-up added a mode-aware native database admission correction and the requested All-view spacing fix. The small-model agent ran the official Mobile check successfully with 1,331/1,331 host tests and zero architecture violations. Focused installation/adoption tests passed 25/25, the isolated service harness tests passed 6/6, and the native fixture project/preparer tests passed 7/7. After the spacing change, the existing list-performance suite passed 4/4 and official Mobile typecheck passed again. The native simulator evidence for these corrections is in `real-sync-verification.md`.

## Release and acceptance limits

The implementation agent completed the REVIEW.md Bugs, Security, and Compliance passes against `rss-local-first`, including its review-follow-up scenarios. The four reported Important issues and the related add/refresh overlay races are addressed by the implementation and regression tests. No additional Important finding remains from this local review. Native acceptance evidence and limits are documented separately below and in `native-verification.md`.

Production rollout order is API schema migration and API deployment, then publication of the production `rss_v1` Sync Config, then Web and Mobile clients. Production Sync Config authorization depends on `sr_rss_subscription`, `sr_rss_feed`, and `sr_rss_entry`, together with `sr_user` and `sr_user_lab_feature` for user and Labs gating. No production migration, service change, config publication, or deployment was performed here.

The human explicitly declined an additional Mobile version bump. Native acceptance used `1.0.25`, build `771`, previous build `770`. The final integration inherits the latest `dev` metadata (`1.0.25`, build `773`, previous build `772`) without introducing a manifest version difference relative to that base; see `delivery.md`.

The native acceptance results and their distinct scopes are recorded in `native-verification.md` and `real-sync-verification.md`. Android simulator and physical-device acceptance were not run. Host tests and JavaScript bundle export do not establish offline behavior across all device platforms. Web SQLite still reads the full local entry result from the database; only row-to-contract mapping for the selected visible window plus one look-ahead row is bounded. REST history keeps the approved anchored re-walk behavior, whose cost grows with the expanded history depth.

## Local PowerSync service scope

The human clarified that PowerSync is available only locally. No remote development, beta or test environment was used. The earlier read-only health checks of existing services at `127.0.0.1:18080` and `127.0.0.1:18081` established health only; they did not establish `rss_v1` delivery.

The later real-sync run uses the reproducible `apps/mobile/tests/data/rss-real-service.mjs` harness: task-owned PostgreSQL databases replay all 52 branch migrations, an owned publication includes 45 tables, and the real PowerSync service loads the exact branch Sync Config. Synthetic accounts, RSS rows and a bookmark are inserted only into PostgreSQL. The native client starts with zero RSS/bookmark rows, uses the production runtime, connector and repositories, and receives rows through actual synchronization. Service-side credentials are generated locally in memory; existing shared services and operator configuration are untouched. Exact transport, first-sync, SQLite, UI, ownership, history, Labs and reconnect evidence is recorded in `real-sync-verification.md`. This supersedes the earlier health-only limitation without changing the historical seeded-run scope.

## Host artifact cleanup

After recording the completed checks, removed the task-generated Web `.nuxt` cache and public `deploy/local/.generated/web/wrangler.toml` projection, Mobile `dist` and `.expo` directories, generated `apps/mobile/assets/pdf/bundle.json`, and this task's temporary test/validation logs. The tracked PDF manifest and licenses remain; the existing preparation scripts regenerate the PDF bundle when needed. Pre-existing Web `.data`, dependency stores, native project templates and other tasks' files were preserved. The simulator, isolated native project and its build/cache cleanup are recorded in `native-verification.md`.

For the subsequent real-sync run, independently verified that its simulator is absent from the complete simulator inventory, its fixture project and standalone failed-build result bundle are absent, its API/sync/Metro ports have no listeners, and its owner-labeled Docker containers, volumes and networks are absent. The root PDF bundle regenerated by the final checks was removed. Shared local services remain healthy. Cleanup also exposed and corrected a macOS temp-path alias issue in the test harness; cleanup failures now return a nonzero exit rather than silently succeeding. The final Bugs, Security and Compliance review against `rss-local-first` found no Important findings.
