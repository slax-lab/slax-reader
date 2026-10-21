# Native RSS Acceptance

This document records the earlier seeded SQLite/offline fixture run. The subsequent real PostgreSQL → PowerSync `rss_v1` → iOS acceptance, including initially empty RSS tables, is recorded separately in `real-sync-verification.md`.

## Target and scope

Acceptance ran on one task-created Apple Silicon iOS Simulator: `Slax RSS Acceptance`, UDID `33B91140-B5AF-4220-9481-C9502E9D1AC9`, runtime iOS 27.0. The installed Xcode SDK was iOS 27.1. No older Xcode was available. No Android target or physical device was used.

The fixture used a distinct app identity, `app.slax.reader.uifixture.rssacceptance`, and a task-owned fixture project. It exercised the current RSS repository/controller against the fixture's actual PowerSync-backed SQLite database. The fixture transport was offline: Labs, RSS subscriptions, and RSS REST entries returned synthetic 503 responses, while the local sync state remained pending (`hasSynced: false`). No remote PowerSync or API environment was contacted. Bookmark deletion was a fixture-only call to the local repository's delete operation; this does not establish server-side deletion or sync acknowledgement.

## Native lifecycle constraint

The initial fixture launch failed with iOS 27's `UIScene life cycle is required for apps built with this SDK` error. Expo 57.0.27 includes the official `EXExpoAppSceneDelegate` backport and `ExpoReactNativeFactoryProvider`. The task-owned fixture preparer applies a guarded, idempotent change to its generated AppDelegate and Info.plist, then records the prepared-file digests in the fixture marker. The fixture launched with this configuration. Production native lifecycle files were not changed or validated by this run; production's current SDK 27 lifecycle compatibility remains separate work.

References: [Expo iOS scene lifecycle guidance](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md) and [Apple's scene-based lifecycle documentation](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle).

## Results

The native screen rendered three cached rows in All: “Alpha cached unsaved article”, “Alpha cached saved article”, and “Beta cached article”. Selecting Alpha showed only its two rows; selecting Beta showed only the Beta row; returning to All restored all three. These conclusions came from inspected simulator screenshots, not the fixture control response. The fixture controller snapshot also reported `ready: true`, two subscriptions, three entries, and the expected selected source.

The saved Alpha row initially displayed its saved state. After the fixture-only local delete action, the row visibly changed to “Save to Inbox”. The app was then terminated and relaunched on the same simulator with the same fixture app container and database. On reopening RSS, the screen still showed all three cached rows and the deleted bookmark remained unsaved. The fixture reported `reusedExistingDatabase: true` and `seededRowsThisLaunch: false`; a direct query of the same SQLite database showed three entries and the `rss-saved-bookmark` row still soft-deleted (`deleted_at IS NOT NULL`). This is same-database cold-relaunch evidence, not a newly seeded launch.

The local repository/controller were ready and source switching remained available during the synthetic offline/pending-sync state. This verifies cached local RSS rendering and filtering under the fixture failure responses. It does not verify real server synchronization, schema upgrade on an existing production database, physical-device behavior, or native-device query-plan performance. Query performance measurements remain covered only by the existing host SQLite tests.

## Reproduction

Run from the repository root. `fixture:project` prints its generated task-owned project path; assign that exact path to `PROJECT`. Create one fresh simulator with an installed iOS 27.0 runtime and set `SIM_ID` to its returned UDID. Use that same project and simulator for preparation, build, launch, all controls, and relaunch. The environment below disables dotenv/local config loading and selects only the local fixture.

```sh
SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- fixture:project --scenario rss-populated --locale en --platform ios --identity rssacceptance
PROJECT=/private/var/folders/<task-temp-root>/T/slax-reader-ui-fixture-<generated-id>
SIM_ID="$(xcrun simctl create 'Slax RSS Acceptance' \
  com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro \
  com.apple.CoreSimulator.SimRuntime.iOS-27-0)"
xcrun simctl boot "$SIM_ID"
node apps/mobile/tests/data/prepare-rss-native-fixture.mjs "$PROJECT"
node "$PROJECT/tooling/fixture-project.mjs" --project "$PROJECT" --verify

mkdir -p "$PROJECT/TaskTmp" "$PROJECT/CocoaPodsHome" "$PROJECT/CocoaPodsCache" \
  "$PROJECT/ModuleCache" "$PROJECT/SourcePackages" "$PROJECT/DerivedData"
cd "$PROJECT/ios"
EXPO_NO_DOTENV=1 EXPO_PUBLIC_SLAX_UI_FIXTURE=rss-local-native-offline \
  EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=rssacceptance EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=en \
  EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 TMPDIR="$PROJECT/TaskTmp" \
  CP_HOME_DIR="$PROJECT/CocoaPodsHome" CP_CACHE_DIR="$PROJECT/CocoaPodsCache" pod install

EXPO_NO_DOTENV=1 EXPO_PUBLIC_SLAX_UI_FIXTURE=rss-local-native-offline \
  EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=rssacceptance EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=en \
  EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 TMPDIR="$PROJECT/TaskTmp" \
  CP_HOME_DIR="$PROJECT/CocoaPodsHome" CP_CACHE_DIR="$PROJECT/CocoaPodsCache" \
  xcodebuild -workspace "$PROJECT/ios/SlaxReader.xcworkspace" \
  -scheme SlaxReader -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SIM_ID" \
  -derivedDataPath "$PROJECT/DerivedData" \
  -clonedSourcePackagesDirPath "$PROJECT/SourcePackages" \
  CLANG_MODULE_CACHE_PATH="$PROJECT/ModuleCache" \
  SWIFT_MODULE_CACHE_PATH="$PROJECT/ModuleCache" \
  ONLY_ACTIVE_ARCH=YES ARCHS=arm64 CODE_SIGNING_ALLOWED=NO build

cd "$PROJECT"
CI=1 TMPDIR="$PROJECT/TaskTmp" EXPO_NO_DOTENV=1 \
  EXPO_PUBLIC_SLAX_UI_FIXTURE=rss-local-native-offline \
  EXPO_PUBLIC_SLAX_UI_FIXTURE_ID=rssacceptance EXPO_PUBLIC_SLAX_UI_FIXTURE_LOCALE=en \
  EXPO_PUBLIC_SLAX_ADOPTION_FIXTURE=0 \
  node node_modules/expo/bin/cli start --dev-client --port 8084 > "$PROJECT/TaskTmp/metro.log" 2>&1 &
xcrun simctl install "$SIM_ID" \
  "$PROJECT/DerivedData/Build/Products/Debug-iphonesimulator/SlaxReader.app"
xcrun simctl launch "$SIM_ID" app.slax.reader.uifixture.rssacceptance
xcrun simctl openurl "$SIM_ID" \
  'slaxreader-ui-fixture-rssacceptance://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8084'

node "$PROJECT/tooling/fixture-control.mjs" --platform ios --device 'Slax RSS Acceptance' --identity rssacceptance --port 8084 --action '{"kind":"select-list","list":"rss"}'
node "$PROJECT/tooling/fixture-control.mjs" --platform ios --device 'Slax RSS Acceptance' --identity rssacceptance --port 8084 --action '{"kind":"select-source","id":"rss-alpha"}'
node "$PROJECT/tooling/fixture-control.mjs" --platform ios --device 'Slax RSS Acceptance' --identity rssacceptance --port 8084 --action '{"kind":"select-source","id":"rss-beta"}'
node "$PROJECT/tooling/fixture-control.mjs" --platform ios --device 'Slax RSS Acceptance' --identity rssacceptance --port 8084 --action '{"kind":"select-source","id":null}'
node "$PROJECT/tooling/fixture-control.mjs" --platform ios --device 'Slax RSS Acceptance' --identity rssacceptance --port 8084 --action '{"kind":"delete-bookmark","id":"rss-saved-bookmark"}'
xcrun simctl io "$SIM_ID" screenshot "$PROJECT/TaskTmp/rss-all-after-delete.png"
xcrun simctl terminate "$SIM_ID" app.slax.reader.uifixture.rssacceptance
xcrun simctl launch "$SIM_ID" app.slax.reader.uifixture.rssacceptance
node "$PROJECT/tooling/fixture-control.mjs" --platform ios --device 'Slax RSS Acceptance' --identity rssacceptance --port 8084 --action '{"kind":"select-list","list":"rss"}'
xcrun simctl io "$SIM_ID" screenshot "$PROJECT/TaskTmp/rss-all-after-cold-relaunch.png"
DATA_DIR="$(xcrun simctl get_app_container "$SIM_ID" app.slax.reader.uifixture.rssacceptance data)"
DB="$DATA_DIR/Library/Caches/slax-ui-fixtures/rss-local-native-offline/fixture.db"
test -f "$DB" || { echo "fixture database missing: $DB" >&2; exit 1; }
sqlite3 "$DB" \
  "SELECT COUNT(*) FROM sr_rss_entry; SELECT id, deleted_at IS NOT NULL FROM sr_user_bookmark WHERE id='rss-saved-bookmark';"
```

The fixture control automates state changes; it does not certify visible UI. Capture and inspect simulator frames after source selection, delete, and relaunch. Keep the local simulator/app container between termination and relaunch. Use the same fixture-control command for any capture on port 8084; the port must match Metro.

The fixture project was verified with its generated-source digest guard after preparation. Its preparer adds the synthetic scenario and updates scenario, manifest, and marker digests; it also applies and records the temporary fixture-only scene configuration. The fixture control script reports `nativeInteractionVerified: false`; screenshots were separately inspected from the simulator to verify the visible row contents and saved-state label.

## Host checks and limits

The final Mobile typecheck completed successfully (`SLAX_MOBILE_NO_LOCAL_CONFIG=1 EXPO_NO_DOTENV=1 pnpm mobile -- typecheck`). The focused fixture-tool suite passed 10/10 tests, including isolated identity/port validation, project digest preparation, scene-shim guards, and fixture inspector endpoint validation. Existing RSS controller/data tests had previously passed 35/35. The broader Mobile host suite completed separately with 1,319 passing tests, zero failures, and zero skips. No Android build or test was run.

The root typecheck regenerated the ignored `apps/mobile/assets/pdf/bundle.json`; the parent task owns removal of that root-level generated bundle. Mobile version metadata intentionally remains 1.0.25, build 771, previous build 770, per the human decision for this task.

## Cleanup

Cleanup completed: both task fixture projects, the task simulator, and the task Metro process on port 8084 are removed. This also removed task DerivedData, module/source-package caches, CocoaPods home, screenshots, and raw logs. The four `SlaxReader` diagnostic reports at 12:55:14, 12:55:14.000, 12:55:18, and 12:55:20 on 2026-10-20 were confirmed by bundle ID `app.slax.reader.uifixture.rssacceptance` and removed. The pre-existing shared CocoaPods cache, existing simulator devices, and unrelated Metro process on port 8083 were preserved. The root-level ignored PDF bundle generated by the typecheck was already removed by the parent task.
