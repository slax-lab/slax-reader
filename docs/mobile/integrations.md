# Mobile Integration Approvals

The human approved the complete `expo-mobile-migration` proposal on 2026-10-10 and explicitly requested implementation. The accepted scope remains the complete source application, one-to-one native UI evidence, genuine native back controls, and recoverable legacy offline data upgrades.

| Integration | Approved packages or runtime | Status |
| --- | --- | --- |
| Runtime and platform floor | Expo SDK 57, React Native, React; iOS 16.4+, Android API 26+ | Approved |
| Native navigation | `@react-navigation/native`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context` | Approved |
| Reading container | `react-native-webview` | Approved |
| Offline data | `@powersync/react-native`, `@op-engineering/op-sqlite`, required PowerSync common peer | Approved |
| Development build | `expo-dev-client` | Approved |
| System capabilities | `expo-file-system`, `expo-clipboard`, `expo-haptics`, `expo-localization`, `expo-network`, `expo-secure-store`, `expo-sensors` | Approved |
| Gestures and animations | `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets` | Approved |
| Provider authentication | `expo-apple-authentication`, `react-native-nitro-google-signin`, `react-native-nitro-modules` | Approved |
| iOS purchases | `expo-iap` | Approved |
| Firebase wrappers | `@react-native-firebase/app`, `@react-native-firebase/analytics`, `@react-native-firebase/crashlytics` | Approved |

Required transitive runtime dependencies belong to their approved integration; this does not approve unrelated optional packages. Source-native code may fill gaps. Further optional integrations still require specific human approval before adoption.

The first reply authorized navigation/WebView and SDK 57/iOS 16.4. The second authorized PowerSync/SQLite. The proposal approval explicitly requested implementation. The subsequent reply authorized the three development/system/gesture groups above. Later replies authorized the provider, purchase, and Firebase groups shown in the table.

The human selected `1.0.25 (757)` as the new version and confirmed that the previous published build numbers are below `757`. On 2026-10-11, the human further authorized packaging only iOS and uploading to the existing TestFlight app once the migration is complete. This authorizes the publisher-signed iOS archive/export/upload through existing opaque Apple account tooling after acceptance; it does not add optional dependencies or authorize public App Store publication, Android release distribution, or backend deployment. See [the release guide](release.md) for the required artifact and processing evidence.

Later on 2026-10-11, the human requested build `758`, then explicitly instructed immediate TestFlight preview delivery from the existing signed archive without waiting for complete acceptance or Firebase configuration. Apple accepted that upload; this did not certify full migration parity. On 2026-10-12, the human requested another build increment, TestFlight and Git delivery, followed by Slax-owned generated-output/cache/simulator cleanup. The current preview target is `1.0.25 (759)`, with previous uploaded build `758`. The same preview exception applies; incomplete physical-device performance, suspension and telemetry checks remain open. No public App Store publication, production backend deployment or unrelated project cleanup is authorized. Source and operator configuration are retained.

The human confirmed that Xcode is signed in with signing and upload access to team `8G3A932HJG`. Filename-only inspection located the legacy main-app Firebase configuration at `../slax-reader-client/iosApp/iosApp/GoogleService-Info.plist` and Android configuration at `../slax-reader-client/composeApp/google-services.json`; no separate Share-extension configuration was located. Configuration contents have not been read or copied. The public Google OAuth client IDs are already present in the legacy public application plist.

The human explicitly accepted only the Android English/light populated-Library default-font and enlarged-font anti-aliasing differences (37 and 38 pixels, RGB differences of 1–2 out of 255). This does not accept other pages, profiles, or interaction failures. The human also approved correcting `mobile-app-parity/spec.md`, `design.md`, and tasks 6.3/6.5 to match the source flat list, star/archive swipe, and direct Library menu deletion. Existing Reader, comment, and account-deletion confirmations and historical acceptance records remain intact.
