# Isolated source Android capture adapter

This overlay invokes the existing `InboxListScreen`, `SettingScreen`, `FeedbackScreen`, `AboutScreen`, `LoginScreen`, and Reader `DetailScreen`. Inbox data flows through the actual PowerSync schema, DAOs, and view models. RSS calls use the source `RssApi` contract and the same pinned JSON response envelopes as Expo. The source adapter uses Compose semantics for supported scripted interactions and captures real native pixels through Android instrumentation.

The adapter and sanitized build template have been written and their staging process has been exercised. The isolated application and instrumentation APKs compiled successfully on October 10, 2026 with Gradle 8.13 and Java 17. The initial instrumentation compilation failed on stale inherited legacy tests and an older HTTP adapter import; the capture target now compiles only its own test overlay. The actual populated Library screen ran on controlled Android API 34 emulator `emulator-5560`; its inspected historical native frame has six rows, collection controls, the continue-reading banner, displayed 9:41, light appearance and default font scale. Its build/overlay/capture inputs are archived under `docs/mobile/evidence/2026-10-10-source-android/`. The capture predates the required shared synthetic timezone field and is absent from the current ledger; recapture is required. Reader has not passed native document readiness. Target comparisons and the full state/profile matrix remain unverified. Native player events, RSS image loading, source iOS, deletion notice, upgrade gate, hardware/predictive back, and lifecycle actions remain unbound. Unsupported routes/actions fail. RSS artwork cannot render until a prepared native image loader is supplied; the isolated source manifest removes Internet permission to prevent remote loads. These limitations prevent treating task 1.4 as complete.

`SourceReaderAdapter` injects one shared source BookmarkDetailViewModel into the original DetailScreen and its nested Koin components. It renders the unchanged source AppWebView/template, prewrites pinned HTML and artwork into the isolated source cache layout, and prepares actual DOM selections/mark/image/anchor/position commands. `FixtureReaderHttp` uses the existing Ktor core engine API without adding a socket or mock dependency; it rejects unknown origins/routes/offline requests and supplies the same JSON/text/delayed chunks to the actual source API/SSE parser. DOM preparation does not validate long-press coordinates, native selection handles, streaming frame timing, player events, or back/lifecycle behavior. The Reader client closes after view-model disposal and before database teardown.

Prepare an immutable copy from the reviewed source whitelist:

```sh
python3 apps/mobile/fixtures/prepare-source.py \
  --source /Users/daguang/project/slax-reader-client \
  --output /tmp/slax-source-ui-fixture-capture
```

The preparer requires a new temporary directory. It copies only the 356 pinned public source/resource/license files, verifies every checksum, includes the dirty/untracked RSS overlay, adds these test files and pinned fixture assets, and writes `slax-source-fixture.json`. It never copies the original Gradle configuration, credentials, environment files, signing material, Google services files, or native preference/database files. It does not invoke Gradle or change the source checkout.

The preparer now installs reviewed Gradle templates from this directory. They pin the exact public source versions, keep the Compose resource package `slax_reader_client.composeapp.generated.resources`, configure Android/common/instrumentation source sets, and replace generated SlaxConfig with synthetic constants. Pinned legacy tests remain on disk for provenance, while the fixture test target compiles only `src/fixtureInstrumentedTest/kotlin`; it does not require unrelated legacy test dependencies. They do not apply BuildKonfig, dotenv, Google services, Crashlytics upload, production signing, Swift/CocoaPods plugins, or original build scripts. The build uses Gradle 8.13 and Java 17. Use a fresh `--gradle-user-home` outside the source checkout so operator init scripts are not evaluated.

```sh
JAVA_HOME="$SLAX_FIXTURE_JAVA_HOME" ANDROID_HOME="$SLAX_FIXTURE_ANDROID_HOME" \
  "$SLAX_FIXTURE_GRADLE" --gradle-user-home /tmp/slax-source-ui-fixture-gradle-home \
  --no-daemon --max-workers=2 -p /tmp/slax-source-ui-fixture-capture \
  :composeApp:assembleDebug :composeApp:assembleDebugAndroidTest
```

`SourceFixtureActivity` mirrors the original MainActivity edge-to-edge/system-bar setup and creates no production routes or DI. The target uses `com.slax.reader.fixture`; its native agreement WebView renders only pinned local terms/privacy HTML, with CSP, HTTP interception, no file/content access, and no Internet permission. Login receives deterministic provider outcomes and a synthetic AuthGateway; no Google/Apple provider or backend account is used. This verifies the source containers and prepared transitions when executed, and does not verify remote agreements or real provider dialogs.

Library capture waits for actual DAO-fed row IDs, download states and subscribed collection IDs before taking the initial frame. A `BookmarkRepository` delegate keeps every original DAO query/mutation and overrides only `hasSynced` from the declared payload, since the isolated database never connects to PowerSync. The prepared sync/network coordinator supplies the same payload state as Expo. These are controlled inputs, not modified screen rendering. Raw metadata records measured native insets/model/OS/scale/appearance and copied source/fixture/driver digests. Its system-clock sample must be distinguished from the status bar's displayed clock, which needs native-frame inspection or a confirmed device override.

Do not apply the source's credential discovery, Google services, Crashlytics upload, production signing, environment loading, release deployment, or local Gradle initialization scripts. No source build is authorized against the original checkout. Build and install only the isolated application/test APKs after the sanitized template exists. The runner checks the application identity, the absence of merged Internet permission, and that Firebase has not been initialized before rendering. Firebase initialization/collection are disabled by the manifest; source AppPreferences receives an in-memory DataStore with synthetic authentication. A capture-only Firebase actual implementation replaces only the analytics port, so source event calls cannot initialize or contact Firebase. The original screen and event-building source remains byte-identical.

After building the isolated test target, an example connected-device invocation is:

```sh
adb shell am instrument -w \
  -e class com.slax.reader.fixtures.SourceReferenceFixtureTest \
  -e fixtureCase library-populated -e fixtureLocale en \
  com.slax.reader.fixture.test/com.slax.reader.fixtures.FixtureRunner
```

Use one fresh instrumentation process per case/locale. Captures are written to the isolated target's external files `captures/<case>-<run>/` with the fixture marker, actual PNGs, and measured metadata. Keep that directory until evidence is copied; cleanup closes/deletes only the UUID-named fixture database. Every comparison must verify both source/target input hashes and measured native conditions. A host-written adapter, a successful staging run, or programmatically prepared state does not verify a native screenshot, motion, gesture, or navigation behavior.

To reproduce an archived driver instead of the current bundle, add `--overlay-snapshot docs/mobile/evidence/<run>/source-driver-<revision>` to the preparer command. It verifies the exact closed 28-file overlay set, its SHA-256 hashes, embedded fixture manifest and action-driver identity against the pinned original source manifest. Replaying an older archive preserves its older fixture digest; it cannot count toward the current coverage ledger.

Isolate one scripted Reader state with `-e fixtureActionIndex 3` (zero-based original scenario action index) in the instrumentation command. Each invocation creates fresh real DAOs/database/preferences, captures its initial state and then only that declared action. The metadata records `isolatedActionIndex`. User/subscription readiness uses the same real DAO collectors that preceding Library normally activates; it is recorded as `prior-library-shared-user-and-subscription-dao-collectors`, never assigned fake Pro/user values. Programmatic DOM/native callback preparation remains distinct from native touch and gesture evidence.
