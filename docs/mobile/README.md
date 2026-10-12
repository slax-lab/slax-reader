# Mobile development

The Expo application lives in `apps/mobile` and uses the root pnpm workspace. The accepted migration is `expo-mobile-migration`. Its tasks and the [coverage ledger](coverage.json) distinguish implemented code, fixture checks, device runs, and matched native render evidence. A passing JavaScript check does not establish native UI or upgrade parity. The public evidence includes inspectable source, text/JSON records, and PNG captures. Historical reports also retain original paths and digests for local-only native result archives, compiled applications/frameworks, raw execution logs, and unreviewed motion recordings; those bytes are not included in Git. Such references document the original run, not a claim that a clean checkout contains or can reverify the raw artifacts. Independent verification requiring those bytes remains pending until their owner supplies an explicitly authorized, reviewed archive. Recorded hashes and acceptance limits are not rewritten for publication.

Use a supported Node LTS version from the root `engines` declaration and the pinned root pnpm version. Install once at the repository root:

```sh
pnpm install --frozen-lockfile
pnpm mobile -- help
pnpm mobile -- check
pnpm mobile -- bundle
```

`check` verifies source/asset manifests, synthetic fixtures, RSS state transitions, TypeScript, data/reader/payment/telemetry tests, and the share configuration plugin. It needs no production account. `bundle` resolves the Android and iOS JavaScript application with Metro. The optional source check reads only the manifest's closed non-secret whitelist:

```sh
node apps/mobile/assets/verify-baseline.mjs --source /path/to/slax-reader-client
```

All root mobile commands set `EXPO_NO_DOTENV=1`. They do not load the API's local configuration or start other applications. Supply public Expo build inputs through the process environment. Never place tokens, signing credentials, private keys, or Firebase service configuration in public Expo variables or tracked files.

For local development, install Android SDK 36, its build tools, the configured NDK, and Java 17; iOS requires macOS, Xcode, and CocoaPods. Native custom modules and OP-SQLite require a development build:

```sh
pnpm mobile -- prebuild:clean --platform android
pnpm mobile -- build:android
pnpm mobile -- android
pnpm mobile -- dev

pnpm mobile -- prebuild:clean --platform ios
pnpm mobile -- pods
pnpm mobile -- build:ios
pnpm mobile -- ios
```

Use `prebuild:clean` for initial setup and CI: Expo SDK 57 recreates the selected native directories, including development signing fixtures, and removes their existing build outputs. Retain needed artifacts outside those directories first and wait for active builds to finish. For later configuration updates, `pnpm mobile -- prebuild --platform android` or `ios` passes `--no-clean` to update the existing project while retaining build caches. Native reader/data/share implementation belongs in `apps/mobile/modules`, `apps/mobile/native`, and the configuration plugins. Keep operator signing/service files outside regenerated project directories. Both modes apply owned plugins; generated-project edits are not an implementation source. The unsigned iOS build targets a generic simulator; launching and testing requires a working simulator service or an explicitly selected test device.

The app retains `com.slax.reader`, `app.slax.reader`, `app.slax.reader.share`, and `group.app.slax.reader`. A debug APK has a development signing identity; it cannot replace a store installation signed by the original publisher. Test same-identity replacement only on a fresh isolated target containing synthetic data, or through the operator's controlled signed-upgrade workflow.

The application floor is Android API 26 and iOS 16.4. The approved runtime is Expo SDK 57, React Native 0.86, and React 19. All packages are locked. Mobile's React DOM peer is pinned to its React version for dependency resolution; the supported bundle platforms are Android and iOS.

## Public configuration

| Input | Purpose |
| --- | --- |
| `EXPO_PUBLIC_SLAX_API_URL` | Production API origin; defaults to the source production origin |
| `EXPO_PUBLIC_SLAX_BETA_API_URL` | Beta API origin; selected by the migrated Debug preference on restart |
| `EXPO_PUBLIC_SLAX_WEB_URL` / `EXPO_PUBLIC_SLAX_WEB_DOMAIN` | Web pages and the source session-cookie domain |
| `EXPO_PUBLIC_SLAX_GOOGLE_WEB_CLIENT_ID` | Google ID-token audience for the existing backend |
| `EXPO_PUBLIC_SLAX_GOOGLE_IOS_CLIENT_ID` | iOS Google client identifier |
| `EXPO_PUBLIC_SLAX_GOOGLE_IOS_URL_SCHEME` | Reversed iOS client identifier registered by the provider plugin |
| `SLAX_MOBILE_VERSION` / `SLAX_MOBILE_BUILD_NUMBER` | Native marketing version and build number; development defaults are `1.0.0` / `1` |
| `SLAX_MOBILE_PREVIOUS_BUILD_NUMBER` | Last published build number or a recorded, operator-confirmed upper bound; release validation requires a lower value |
| `SLAX_APPLE_TEAM_ID` | Public publisher team identifier for the guarded iOS archive/export/upload commands using the existing Xcode account |

Google authentication defaults to the public client identifiers and reversed callback scheme pinned from the original iOS `Info.plist` in `apps/mobile/assets/source-auth-public.json`. The original `app.slax.reader` application scheme is retained alongside `slaxreader`. The web audience defaults to the source `GIDServerClientID`; the original Android environment value was not inspected. The public environment inputs above override these defaults. Real provider callbacks and backend audience acceptance still require native verification. Controlled fixtures omit the Google callback plugin and use synthetic provider results. Apple and iOS share require the original capabilities and operator provisioning. Firebase's Analytics/Crashlytics SDKs need operator-managed native Firebase configuration before delivery can be verified. Those files are ignored and are never source-migration inputs. An unavailable Firebase app does not block reading or first-party telemetry.

The app-owned `SlaxGoogleAppDelegateSubscriber` forwards registered Google redirect schemes to the approved plugin's native Google Sign-In SDK before general React linking. The plugin's URL-scheme configuration alone does not provide that delegate handler in the installed version. Unrelated URLs and fixture schemes are left to the existing linking handlers. This follows [Google's iOS redirect integration](https://developers.google.com/identity/sign-in/ios/sign-in#1_handle_the_authentication_redirect_url); native provider acceptance remains pending.

The operator can supply `SLAX_MOBILE_FIREBASE_IOS_CONFIG` and/or `SLAX_MOBILE_FIREBASE_ANDROID_CONFIG` as paths to their platform configuration files outside the checkout. Prebuild enables the approved App/Crashlytics config plugins only for the configured platforms, including native initialization and Android build tooling. After CocoaPods integration, the owned Podfile hook removes the SDK's symbol-upload phase for an unconfigured or fixture iOS app; configured iOS builds retain that phase. This permits local native builds without inventing Firebase service configuration. The standalone share target accepts its separately registered iOS configuration through `SLAX_MOBILE_FIREBASE_SHARE_IOS_CONFIG`; the main app's configuration is not assumed to match the share bundle. The agent does not open, migrate, copy, or supply these files; the operator runs configured prebuild locally. Controlled UI/adoption fixtures ignore these inputs and disable automatic collection. This follows the [React Native Firebase Expo setup](https://rnfirebase.io/#installation-for-expo-projects). Native delivery remains pending until a configured application is tested.

See [architecture](architecture.md), [upgrade compatibility](data-compatibility.md), [release procedure](release.md), [integration approvals](integrations.md), [source baseline](migration-baseline.md), [reader compatibility](reader-compatibility.md), [share targets](share.md), [fixture acceptance](fixture-acceptance.md), and the [development build evidence](evidence/2026-10-10-builds/README.md).

The human authorized final delivery as iOS `1.0.25 (757)` to the existing TestFlight app after migration acceptance. `pnpm mobile -- archive:ios`, `export:ios`, and `upload:ios` implement separate publisher-signed device stages; see the release procedure for explicit artifact paths and processing evidence. Android development verification remains part of the complete migration; a final Android release package is not requested.
