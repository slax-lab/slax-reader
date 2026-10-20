# Mobile development

The Expo application lives in `apps/mobile` and uses the root pnpm workspace. The accepted migration is `expo-mobile-migration`. Mobile checks validate the pinned source manifest, copied assets, localization, fixtures, architecture, types, and tests; they do not establish native render parity. Native acceptance remains explicit device or operator verification.

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

All root mobile commands set `EXPO_NO_DOTENV=1`. Native preparation/development and build/release commands explicitly load `deploy/mobile/.env`, with existing process values taking precedence, and discover Firebase/Android signing files under `deploy/mobile/ios` and `deploy/mobile/android`. Expo configuration and direct native build/release scripts use the same loader. Tests, type checking, JavaScript bundle checks, and controlled fixtures skip local configuration. API, Web, and Extension local configuration is not read, and other applications are not started. See [the mobile build-input layout](../../deploy/mobile/README.md) for restoration and signing setup. Never place tokens, signing credentials, private keys, or Firebase service configuration in public Expo variables or tracked files.

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

Use `prebuild:clean` for initial local setup or an explicitly requested clean native rebuild: Expo SDK 57 recreates the selected native directories, including development signing fixtures, and removes their existing build outputs. Retain needed artifacts outside those directories first and wait for active builds to finish. For later configuration updates, `pnpm mobile -- prebuild --platform android` or `ios` passes `--no-clean` to update the existing project while retaining build caches. Native reader/data/share implementation belongs in `apps/mobile/modules`, `apps/mobile/native`, and the configuration plugins. Keep operator signing/service files outside regenerated project directories. Both modes apply owned plugins; generated-project edits are not an implementation source. The unsigned iOS build targets a generic simulator; launching and testing requires a working simulator service or an explicitly selected test device.

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
| `apps/mobile/package.json`: `version` / `buildNumber` | Canonical native marketing version and build code; together represent `1.0.25(770)`; environment version overrides are ignored |
| `apps/mobile/package.json`: `previousBuildNumber` | Confirmed previous build bound, strictly lower than `buildNumber`; update before another store release |
| `SLAX_APPLE_TEAM_ID` | Public publisher team identifier for the guarded iOS archive/export/upload commands using the existing Xcode account |

Google authentication defaults to the public client identifiers and reversed callback scheme pinned from the original iOS `Info.plist` in `apps/mobile/assets/source-auth-public.json`. The original `app.slax.reader` application scheme is retained alongside `slaxreader`. The web audience defaults to the source `GIDServerClientID`; the original Android environment value was not inspected. The public environment inputs above override these defaults. Real provider callbacks and backend audience acceptance still require native verification. Controlled fixtures omit the Google callback plugin and use synthetic provider results. Apple and iOS share require the original capabilities and operator provisioning. Firebase's Analytics/Crashlytics SDKs need operator-managed native Firebase configuration before delivery can be verified. Those files are ignored and are never source-migration inputs. An unavailable Firebase app does not block reading or first-party telemetry.

The app-owned `SlaxGoogleAppDelegateSubscriber` forwards registered Google redirect schemes to the approved plugin's native Google Sign-In SDK before general React linking. The plugin's URL-scheme configuration alone does not provide that delegate handler in the installed version. Unrelated URLs and fixture schemes are left to the existing linking handlers. This follows [Google's iOS redirect integration](https://developers.google.com/identity/sign-in/ios/sign-in#1_handle_the_authentication_redirect_url); native provider acceptance remains pending.

The operator can supply `SLAX_MOBILE_FIREBASE_IOS_CONFIG` and/or `SLAX_MOBILE_FIREBASE_ANDROID_CONFIG` as paths to their main-app platform configuration files outside the checkout. Prebuild enables the approved App/Crashlytics config plugins only for the configured platforms, including native initialization and Android build tooling. After CocoaPods integration, the owned Podfile hook removes the SDK's symbol-upload phase for an unconfigured or fixture iOS app; configured iOS builds retain that phase. This permits local native builds without inventing Firebase service configuration. By explicit user decision, the standalone iOS Share extension has no Firebase integration, configuration input or admission requirement. Repeated prebuild removes its former owned Pod block and resource membership without opening or deleting operator files; run `pnpm mobile -- pods` afterward to reconcile native linkage. Main-app Firebase and both bundles' identity/App Group requirements remain unchanged. The agent does not open, migrate, copy, or supply service files; configured prebuild uses them opaquely. Controlled UI/adoption fixtures ignore these inputs and disable automatic collection. This follows the [React Native Firebase Expo setup](https://rnfirebase.io/#installation-for-expo-projects). Main-app native telemetry acceptance remains pending.

See [architecture](architecture.md), [upgrade compatibility](data-compatibility.md), [release procedure](release.md), [observability](observability.md), [integration approvals](integrations.md), [source baseline](migration-baseline.md), [reader compatibility](reader-compatibility.md), and [share targets](share.md).

Historical preview `1.0.25 (763)` is a completed historical delivery. Its no-further-tests exception does not apply to the current correction/auth/refactor work, which requires testing. Live metadata, range, and headless PDF.js checks are separate from native Expo, cold-start, and PowerSync acceptance. No new release or backend deployment is authorized. Main Firebase checks remain enforced; Share Firebase is explicitly excluded. See the [release procedure](release.md) for the historical delivery and future separately authorized stages.
