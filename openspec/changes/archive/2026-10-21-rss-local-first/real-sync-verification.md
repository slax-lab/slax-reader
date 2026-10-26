# Local RSS Sync Native Verification

## Result

Real `rss_v1` synchronization passed on one iOS Simulator using the production mobile data runtime, production PowerSync connector, RSS repository, and controller. RSS rows arrived in SQLite only through PowerSync replication from the isolated local migrated PostgreSQL service. No RSS rows or sync status were injected into the app. The test exercised owner filtering, current-entry/history filtering, bookmark joins, Labs removal and restoration, offline cold launch, an offline server mutation, and same-database reconvergence.

This is simulator acceptance, not physical-device acceptance. The simulator used the installed iOS 27.0 runtime and Xcode 27.1 SDK. Expo's SDK 57 scene lifecycle compatibility was enabled only in the generated fixture project. The copied native legacy bridge was also guarded to the task bundle and private app sandbox because the production bridge requires the production bundle ID and app group. Neither native change was made to production source. Production SDK lifecycle and shared-container behavior remain outside this acceptance result.

The first native database also exposed an admission mismatch: a native-created schema at format migration 14 had SQLite `user_version=0`, while admission accepted only version 1. The production admission fix now permits 0 or 1 only for native-created databases and keeps adopted databases strict at 1; table/format checks remain in place and no PRAGMA stamp or database reset was used. After this fix, the same simulator database passed admission and the sync scenarios ran against it.

## Target and local service

- One fresh iOS Simulator: iPhone 18 Pro, iOS 27.0, UDID `81AE7023-79DF-4ABC-B26C-FF0EB305F7DD`; task bundle ID `app.slax.reader.uifixture.rssacceptance`.
- Generated fixture project: `/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-UTG438`.
- Local-only controlled test API and PowerSync proxy: `127.0.0.1:18878` and `127.0.0.1:18879`. The API handled synthetic auth, Labs controls, and bounded server-side test mutations; it was not the production Cloudflare Worker. The service used the branch's PowerSync configuration and RSS sync rules (SHA-256 `8cafbdb47f73a966593be2225028f7bc5cf7cd42fa1122397b86733f5d7e9e78` and `0fed2a90ecb6ceac44f25ea325d7e66ed7e75c5297502637fac8545022f71186`), 52 completed migrations, and a 45-table publication. The service signing key and issued JWTs stayed in the local service process. Synthetic app sessions were stored in the task simulator's app preferences during the run and removed with the simulator. No real account or remote endpoint was used.
- Synthetic owners were A (`rss-local-user-a`) and B (`rss-local-user-b`). Initial server data had A's and B's subscriptions to one shared feed with separate private remarks, B's private feed and entry, one live shared entry, one excluded historical entry, and A's bookmark for the live URL.

After native acceptance, four newly added Sync Config comments were translated to English; all query SQL and YAML values remain unchanged. The rules hash recorded above identifies the accepted run; the current comment-only revision has SHA-256 `79e894deb1405335b6ac8a5ad299bf37b513bb3cdc02d53f4e72bdb0058dc4e7`.

## Evidence

The initial native database snapshot had zero RSS subscriptions, feeds, entries, and bookmarks. The service accepted the `fresh-empty` receipt while PowerSync was gated and `hasSynced` was false. After opening the sync gate, the actual stream emitted its first-ready callback; the database reported `connected=true`, `hasSynced=true`, and a non-null `lastSyncedAt`.

For owner A, the actual SQLite snapshot and controller each contained one subscription (`rss-local-sub-a`), one shared live entry, and one bookmark. A's private remark was visible. B's private subscription, remark, feed, and entry were absent, as was the historical entry. The accepted `first-sync` service checkpoint recorded 1 subscription, 1 entry, 1 bookmark, zero other-owner rows, and zero history rows. A's saved article was visible as `Saved` in the native frame.

The test switched the production runtime session on the same simulator to synthetic owner B. B's SQLite/controller snapshot contained the shared feed and B-only feed (2 subscriptions, 2 live entries), no bookmark, and no A-owned rows or excluded history. B's private remark appeared and A's private remark did not. The service accepted the `owner-isolation` checkpoint with those counts. Switching back to A restored A's isolated view.

Server-side remark and live-entry edits replicated into the existing native database and controller. A showed the changed remark and entry title/summary while the bookmark remained saved. Calling the controlled local Labs endpoint changed the real migrated PostgreSQL row; PowerSync then removed A's RSS subscriptions, feeds, and entries from native SQLite while preserving the bookmark. Re-enabling Labs restored the RSS rows and retained the bookmark. The `labs-disabled`, `bookmark-preserved`, and `labs-reenabled` receipts were accepted by the local service. The controlled REST list endpoint returned no RSS rows. Upstream RSS fetching, HTML ingestion, and the production Cloudflare API workers were not exercised end to end.

With API and sync unavailable, the app was terminated and relaunched against the same app container and database. It reused the persisted fresh-empty receipt; it did not reseed or clear the database. The cached controller was ready with 1 subscription, 1 entry, and 1 bookmark while `connected=false`. The offline native screenshot showed the previously synced title, remark, and saved marker. On the first gate reopen, no immediate live retry was observed in the bounded wait; an online cold relaunch of the same app/database then reconnected and preserved the cache. In a second offline interval, the service changed the entry title to `RSS Local Live Entry offline-v2` and summary to `Changed while API and sync were gated`. The disconnected native SQLite/controller still showed the preceding title. After both gates reopened, the live client reconnected without relaunch; within 10 seconds SQLite and the controller contained `offline-v2`, with a newer `lastSyncedAt`. The native All view showed the updated title, summary, and Saved state. The service accepted the final `reconnected` receipt.

Final authenticated service status reported all nine accepted phases (`fresh-empty`, `first-sync`, `owner-isolation`, `remark-update`, `entry-update`, `labs-disabled`, `bookmark-preserved`, `labs-reenabled`, `reconnected`), API and sync gates open, the updated PostgreSQL row, and the active `pgoutput` slot at confirmed flush LSN `0/17EECA0`. Transport totals were 35 sync HTTP requests, 3,187 client-to-service bytes, 8,782 service-to-client bytes, 27 requests intentionally blocked while the sync gate was closed, and zero WebSocket upgrades. This validates the HTTP sync path exercised by the app; it does not claim a WebSocket upgrade.

Native pixels were inspected separately from fixture-control snapshots. The post-fix All screenshot showed the updated row and no empty source toolbar; the selected-source frame retained its active ring and refresh/menu controls. The source menu visibly contained Refresh, Edit name, and Unsubscribe. The final All frame showed the server-updated title and summary and the Saved marker. These screenshots and raw logs were task-local evidence and were removed during cleanup.

## Reproduction

Use a fresh task-owned simulator and a generated fixture project; do not reuse an existing app container. The fixture project command runs the normal pre-fixture bundle preparation. The service command starts isolated migrated PostgreSQL, actual PowerSync with this branch's configuration, and a controlled loopback test API with synthetic identities.

```sh
SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 \
  pnpm mobile -- fixture:project --scenario rss-populated \
  --locale en --platform ios --identity rssacceptance
# Assign the exact project path printed by the generator.
PROJECT='/private/var/folders/REPLACE_WITH_RETURNED_PATH/T/slax-reader-ui-fixture-RETURNED_ID'
RSS_RUN_ID="rss-localfirst-$(date +%s)"
SIM_ID="$(xcrun simctl create 'Slax RSS Real Sync Acceptance' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0)"
xcrun simctl boot "$SIM_ID"
node apps/mobile/tests/data/prepare-rss-native-fixture.mjs "$PROJECT"
node apps/mobile/tests/data/prepare-rss-real-sync-fixture.mjs "$PROJECT"
node "$PROJECT/tooling/fixture-project.mjs" --project "$PROJECT" --verify

# Start the isolated service in another terminal with the same RSS_RUN_ID value; retain its printed owner marker.
node apps/mobile/tests/data/rss-real-service.mjs start --run-id "$RSS_RUN_ID"

mkdir -p "$PROJECT/TaskTmp" "$PROJECT/CocoaPodsHome" "$PROJECT/CocoaPodsCache" \
  "$PROJECT/ModuleCache" "$PROJECT/SourcePackages" "$PROJECT/DerivedData"
cd "$PROJECT/ios"
EXPO_NO_DOTENV=1 EXPO_PUBLIC_SLAX_UI_FIXTURE=rss-local-native-offline \
  EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=rssacceptance EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=en \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_FIXTURE=1 \
  EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 \
  EXPO_PUBLIC_SLAX_API_URL=http://127.0.0.1:18878 \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_URL=http://127.0.0.1:18879 \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_RUN_ID="$RSS_RUN_ID" \
  TMPDIR="$PROJECT/TaskTmp" CP_HOME_DIR="$PROJECT/CocoaPodsHome" \
  CP_CACHE_DIR="$PROJECT/CocoaPodsCache" pod install

EXPO_NO_DOTENV=1 EXPO_PUBLIC_SLAX_UI_FIXTURE=rss-local-native-offline \
  EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=rssacceptance EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=en \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_FIXTURE=1 \
  EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 \
  EXPO_PUBLIC_SLAX_API_URL=http://127.0.0.1:18878 \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_URL=http://127.0.0.1:18879 \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_RUN_ID="$RSS_RUN_ID" \
  TMPDIR="$PROJECT/TaskTmp" CP_HOME_DIR="$PROJECT/CocoaPodsHome" \
  CP_CACHE_DIR="$PROJECT/CocoaPodsCache" \
  xcodebuild -workspace "$PROJECT/ios/SlaxReader.xcworkspace" \
  -scheme SlaxReader -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SIM_ID" \
  -derivedDataPath "$PROJECT/DerivedData" \
  -clonedSourcePackagesDirPath "$PROJECT/SourcePackages" \
  -resultBundlePath "$PROJECT/TaskTmp/RssRealSync.xcresult" \
  CLANG_MODULE_CACHE_PATH="$PROJECT/ModuleCache" \
  SWIFT_MODULE_CACHE_PATH="$PROJECT/ModuleCache" \
  ONLY_ACTIVE_ARCH=YES ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build

cd "$PROJECT"
CI=1 TMPDIR="$PROJECT/TaskTmp" EXPO_NO_DOTENV=1 \
  EXPO_PUBLIC_SLAX_UI_FIXTURE=rss-local-native-offline \
  EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=rssacceptance EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=en \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_FIXTURE=1 \
  EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 \
  EXPO_PUBLIC_SLAX_API_URL=http://127.0.0.1:18878 \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_URL=http://127.0.0.1:18879 \
  EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_RUN_ID="$RSS_RUN_ID" \
  node node_modules/expo/bin/cli start --dev-client --port 8084
APP="$PROJECT/DerivedData/Build/Products/Debug-iphonesimulator/SlaxReader.app"
xcrun simctl install "$SIM_ID" "$APP"
xcrun simctl launch "$SIM_ID" app.slax.reader.uifixture.rssacceptance
xcrun simctl openurl "$SIM_ID" \
  'slaxreader-ui-fixture-rssacceptance://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084'

node "$PROJECT/tooling/fixture-control.mjs" --platform ios \
  --device 'Slax RSS Real Sync Acceptance' --identity rssacceptance --port 8084 \
  --action '{"kind":"select-list","list":"rss"}'
node "$PROJECT/tooling/fixture-control.mjs" --platform ios \
  --device 'Slax RSS Real Sync Acceptance' --identity rssacceptance --port 8084 \
  --observe current
node "$PROJECT/tooling/fixture-control.mjs" --platform ios \
  --device 'Slax RSS Real Sync Acceptance' --identity rssacceptance --port 8084 \
  --action '{"kind":"real-sync-control","operation":"set-sync-available","details":{"available":true}}'
node "$PROJECT/tooling/fixture-control.mjs" --platform ios \
  --device 'Slax RSS Real Sync Acceptance' --identity rssacceptance --port 8084 \
  --action '{"kind":"real-sync-wait","predicate":"rss-stream-first-sync","timeoutMs":15000}'
```

The fixture project command uses the root `rss-populated` scenario; `prepare-rss-native-fixture.mjs` adds and digests the task's `rss-local-native-offline` scenario, and `prepare-rss-real-sync-fixture.mjs` installs the real runtime entry. Set `EXPO_PUBLIC_SLAX_RSS_REAL_SYNC_FIXTURE=1` in the CocoaPods, build, and Metro environments so the app selects that entry while keeping the isolated UI fixture identity. The app automatically verifies and submits `fresh-empty` before publishing its fixture control. Capture that zero-row state with `--observe current`; then open sync only through the explicit `set-sync-available` control above and wait for the actual RSS first-sync callback. The control protocol supports `real-sync-checkpoint`, `real-sync-control` operations `set-sync-available`, `set-api-available`, `update-entry`, and `set-labs`, `real-sync-switch-owner`, and `real-sync-wait`; see `apps/mobile/tests/data/RssRealSyncFixtureApp.tsx` and `apps/mobile/tests/data/rss-real-service.mjs` for the validated synthetic contract. Capture SQLite/controller snapshots with `--observe current`, and inspect native screenshots separately. The UI fixture's RSS data path is the production runtime; its bootstrap, synthetic session identity, scene setup, and native storage bridge are task-only.

The test project's guarded preparer verifies the generated project marker/digests, applies the Expo scene lifecycle configuration only to that project, and copies current RSS UI/admission/runtime sources. The native bridge rewrite is guarded by its exact source hash, task bundle identity, and temp-project boundary. Reproduction is for acceptance tooling; the iOS project and local containers are deliberately disposable.

## Checks and cleanup

The fixture preparer and native controls were exercised on the simulator. The focused real-sync service tests passed 6/6, including cleanup through macOS's temporary-directory alias; the schema-admission tests passed 25/25, and the final Mobile host check passed 1,331/1,331. Mobile typecheck passed after the real-sync fixture source stabilized. After the All-view spacing correction, the existing list-performance suite passed 4/4 and official Mobile typecheck passed again. No Android or physical-device test was run.

The task simulator, fixture project, Metro process on port 8084, task DerivedData, module/source-package caches, CocoaPods home/cache, root ignored PDF bundle, standalone Xcode result bundle, screenshots, and raw logs were removed after review. The backend agent preserved the final status receipt, then removed the marked service containers, volumes, network, and owned temporary directory. No additional task-owned crash report was present in the DiagnosticReports cleanup scan. The unrelated Metro service on port 8083, shared CocoaPods caches, existing simulators, and other task artifacts were preserved. Mobile version metadata remains 1.0.25/build 771/previous 770 by explicit human decision.
