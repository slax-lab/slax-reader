# Validation

## Scope

Mobile only, on `feat/mobile-image-reliability` cut from `origin/dev` at `de3803c3`. Changed areas: Android and iOS native modules (`apps/mobile/modules/slax-platform`), the Mobile data runtime and Reader (`apps/mobile/src`), the app-owned Reader host script and its generated embedding, and one shared type in `packages/reader-embed/src/types.ts`. The API, Web, Extension and ingestion pipelines are not changed. The failed-image placeholder is UI-visible, so `DESIGN.md` §10.2 hands-on acceptance applies (see Human acceptance).

## Automated checks

All results are from 2026-11-27, on the final branch state unless noted otherwise.

- `pnpm mobile -- check` (architecture, typecheck, all Mobile tests), on the final branch state: 1393 tests, 1390 passed, 0 failed, 3 skipped. The three skips are the Kotlin host tests below, which skip in this command without a local OkHttp JVM jar. They were run separately.
- `pnpm mobile -- bundle`: passed for Android and iOS.
- `pnpm exec openspec validate --all --strict`: 195 passed, 0 failed.
- Native host tests, run with `SLAX_OKHTTP_CLASSPATH` / `SLAX_OFFLINE_ENGINE_CLASSPATH` pointing to `okhttp-jvm-5.5.1` and `okio-jvm-3.18.1`. The SHA-1 of both jars was checked against Maven Central's published value.
  - `tests/data/image-registry-native.test.mjs`, `pdf-transfer-native.test.mjs`, `offline-engine-android.test.mjs`, `offline-engine-native.test.mjs`: 6 of 6 passed (Kotlin and Swift).
  - `tests/reader/native-resources-host.mjs`: Kotlin and Swift passed.
- Android dependency graph (`./gradlew :app:dependencies --configuration releaseRuntimeClasspath`): every `com.squareup.okhttp3` artifact resolves to 5.5.1. This covers `okhttp`, `okhttp-android`, `okhttp-urlconnection` and `okhttp-java-net-cookiejar`, and lifts React Native's 4.9.2, Fresco's 3.14.9 and Glide's 3.10.0 declarations. Every Okio artifact resolves to 3.18.1. `:slax-platform:compileDebugKotlin` compiled against 5.5.1 with no new warnings.
- Android Debug build (`assembleDebug`, arm64-v8a): passed. Release build: see Release build below.
- `tests/data/runtime-sync-observability.test.mjs` (14 passed): three spaced sync stream failures produce one `powersync` diagnostic probing only the sync endpoint host, while the existing PowerSync records keep counting each failure. The case fails when the PowerSync hook is disabled.

The new tests were checked against the old behavior, and each fails there:

- The network diagnostic collector test fails 3 of 7 cases without its once-per-family guard.
- The native resource host case for the `/data/user/0`-style alias fails with `Unsafe image staging root` against the previous staging-root check.
- The offline engine gallery case times out waiting for seven concurrent images when the previous serial per-article loop is restored.

New tests:

- `tests/telemetry/network-diagnostics.test.ts` covers every scenario in `mobile-network-diagnostics`: once per family, separate families, offline and client-error suppression, a new process, probe failure and timeout, and no private data.
- `tests/reader/image-failure-browser.test.mjs` runs in real Chrome via Playwright. It covers an in-place placeholder with the localized label and button role, no inserted node, and one `imageError` per source. It also covers a retry that reuses the same request path, restores the source bridge's sizing and gallery tap, a retry that fails again, and a loaded image staying untouched.
- `tests/reader/image-actions.test.mjs` covers bridge parsing of `imageError`, retry-marker stripping for the gallery and image actions, and a placeholder that never long-presses or toggles the toolbar.
- Native: the alias staging root accepted and a linked staging directory rejected; the retry marker accepted and other fragments denied (Kotlin and Swift); the registry limit of 10 per host with the 11th waiting; the staging budget of 10 maximum-size images; and one article's 20 background images reaching exactly 7 concurrent downloads (Kotlin and Swift).

## Running-environment evidence (Android)

Device: Pixel 9 Pro Fold, Android 17 (API 37), Wi-Fi with IPv4 and IPv6. App: Debug build of this branch (1.0.35 / 810 metadata unchanged), JavaScript from Metro on the Mac through `adb reverse`, signed in to the developer's production account.

Device environment notes:

- The device's saved Wi-Fi network had a static HTTP proxy, `192.168.9.225:7890`, whose host was offline.
- The platform's default connectivity check URL is unreachable without that proxy.
- For the exercise, the proxy was set to None and the captive-portal URLs to `www.google.cn/generate_204`.
- Both were restored afterwards: the proxy is back to `192.168.9.225:7890` with an empty exclusion list, and the captive-portal settings are deleted. Both were checked with `dumpsys`.
- With the dead proxy in place, every app request fails, including on `origin/dev`. This is an environment condition, not a regression.

Root cause of the reported missing images, found on this device:

- `SlaxImageResources.registry` threw `IllegalStateException: Unsafe image staging root` on every image.
- `cacheDir` is reported as `/data/user/0/com.slax.reader/cache` and canonicalizes to `/data/data/com.slax.reader/cache`, with no symbolic link involved.
- Before the fix, the device's offline manifests held 878 `denied` and 53 `failed` image entries, and 2 of 118 cached articles had any image file.
- The same proxy URLs returned `200 image/webp` from the Mac.
- This code is on `origin/dev` and predates this change (introduced in `d033836a`, 2026-10-15).

Exercised scenarios:

- **Reader images load (fix).** A 31-image article (`M6 MacBook Pro 體驗…`) that showed retry placeholders before the staging-root fix rendered every image after it.
- **Reader images persist offline (fix).** A second alias defect was found here. `SlaxResources` derived the cache-relative path from `context.dataDir` against a canonical cache file and produced `../../../data/...`, so persisting failed. After resolving `dataDir` once, all 31 images were written under `bookmark/<key>/images/`. With Wi-Fi disabled, the article rendered all images from the cache.
- **Placeholder while offline.** In an article whose images were not cached, with Wi-Fi off, each image showed the gray broken-image placeholder with `点击重试`, in place, with no layout collapse. No network diagnostic was recorded while offline.
- **Tap to retry.** Three cached images of the 31-image article were deleted and the article was opened offline: 28 loaded and exactly 3 showed placeholders. After Wi-Fi was restored, tapping the placeholders, checked through WebView DevTools, did the following:
  - The native intercept received `#slax-retry-1`, stripped it and passed the signed-proxy policy.
  - All three images loaded at 1080 px. The source bridge restored its inline display and the `role=button` was removed.
  - The images were written back, so the cache returned to 31 files.
  - The first device attempt found that Android passes the fragment of a custom-scheme URL to `shouldInterceptRequest`, so the signed-proxy check rejected it. The fragment is now stripped natively before the policy on Android and iOS.
- **Image network diagnostic.** Opening the article before the fix produced exactly one `image` diagnostic, as the device log showed in the development build. It contained:
  - `host=api-reader.slax.com`
  - `dns.system` v4 3 / v6 3, `dns.public` v4 3
  - `tcp.v4` and `tcp.v6` both connected
  - `network` wifi, no VPN, unmetered, validated, private DNS off, IPv6 route
  - after the failure-cause change, `image_failure={"error":"IllegalStateException"}`

  No address, URL or token appears.
- **OkHttp 5 across the app.** After the change the following kept working:
  - Expo fetch, the API and PowerSync (library list and sign-in state)
  - Expo dev-client JavaScript and lazy bundles through React Native networking
  - expo-image and Fresco avatars
  - the Reader's native image transport

  Logcat showed `FastFallbackExchangeFinder` in use, and there were no `NoSuchMethodError` or `NoClassDefFoundError` errors.
- **Background downloads.** After the fix, background acquisition produced 42 `ready` image entries and 79 image files on the device. Seven-way concurrency was asserted in the native hosts rather than on the device, because the device had no pending background images left to observe.

## Release build

`./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (unsigned verification artifact, `android.enableMinifyInReleaseBuilds=true`) passed and produced a 52 MB `app-release-unsigned.apk`.

- R8 reported no `Missing class` or other errors.
- The APK carries OkHttp 5's `PublicSuffixDatabase.list` asset, and its embedded user agent is `okhttp/5.5.1`.

After the version bump, a 1.0.36 (811) Release APK built the same way was signed with the repository's debug keystore (matching the installed package's signature, so app data was kept) and installed on the Pixel 9 Pro Fold (Android 17) with `adb install -r`. The package reported `versionName=1.0.36`, `versionCode=811`. The device reached the production API through the Wi-Fi HTTP proxy on the host Mac. The exercise on 2026-11-28 (Asia/Shanghai):

- **Placeholder and retry.** With Wi-Fi off, an article whose image was not cached showed the failed-image placeholder: a neutral block with a crossed-out image icon and the localized "点击重试" (tap to retry) label. With Wi-Fi back on, tapping it showed the neutral loading block, and the image rendered within about five seconds.
- **Two-level proxied images.** The tweet bookmark still showed the placeholder for its images, as expected until the API-side fix in a separate change is deployed.
- **Diagnostic delivery.** The production client-error lake (`client_errors.errors`) received one `kind=network` record for release `1.0.36+811` at 2026-11-27T16:14:30Z after the app moved to the background: `family=image`, `host=api-reader.slax.com`, system and public DNS answer counts and timings, IPv4 and IPv6 TCP connect results, `network.transport=wifi`, `validated=true`, and `image_failure={"error":"SlaxImageFailure","terminal":true}`. The record carried no URL, address or content. No second image record was sent in that session. PowerSync telemetry rows for the same release arrived in the same lake.

## Not verified

- **iOS on a device or simulator.** iOS changes were verified only by the Swift native host tests and a `swiftc -typecheck` of the new probe against the iOS 16.4 simulator SDK. These changes are the probe, registry limits, parallel background images, the Reader image worker width and retry-marker stripping. No iOS device build or exercise was performed. The iOS staging-root path was checked: Foundation's `cachesDirectory` already resolves to itself.
- **PowerSync and content diagnostics on a device.** These paths are covered by the collector tests and the runtime wiring. No sync or content failure occurred on the device during the exercise.
- **Stale `denied` manifest entries.** On affected production installs the staging-root exception has no HTTP status, so background acquisition recorded those images as retryable `failed` entries, which the fixed build retries without an attempt cap. The 878 `denied` entries on the test device came from switching that device between development and production API origins: their proxy origin was outside the development build's admitted image-proxy origins. `denied` entries stay excluded from background acquisition; the Reader still loads them on open. The change requester decided on 2026-11-28 not to re-admit them.
- **Two-level proxied images.** A tweet bookmark's images are proxy URLs whose `u` parameter is itself a proxy URL. The outer proxy redirects to `notfound.png`, which the client correctly refuses. This is an API-side issue outside this change.

## Human acceptance

On 2026-11-28 the change requester accepted the Android Reader behavior from the 1.0.36 (811) Release screenshots of the failed-image placeholder, the retrying state and the loaded image, and asked for the pull request as an urgent fix. Nothing was adjusted. On 2026-11-27 the change requester approved the Mobile version increment to `1.0.36 (811)`, previous build 810. The two-level proxied tweet images are handled by a separate API change.
