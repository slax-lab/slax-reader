# Design

## Context

- `apps/mobile/src/data/runtime.ts` owns the Mobile `errorLog` adapter. It adds `online`/`foreground` and PowerSync failure context and captures PowerSync failures in `captureSyncFailure`. The shared collector (`packages/frontend-utils/src/errorLog.ts`) groups records by fingerprint, backs off repeats, and is best effort.
- Both platforms already expose a DNS diagnostic, `SlaxPlatform.resolveDns(host, server)`, used only by the Debug screen.
- Reader images use the `slaxstatics:` scheme. Android's `SlaxResources.image` and iOS's `SlaxWebImageTask` serve them from the app-owned cache or from the shared `SlaxImageRegistry`. On failure they return an empty response, or fail the scheme task on iOS, with no signal to JavaScript.
- `SlaxImageRegistry` (Kotlin and Swift) runs three workers and allows two in flight per host. It reserves 20 MiB per running job against a 60 MiB budget, so at most three run at once.
- Background acquisition (`SlaxOfflineEnginePlan`) limits content jobs to three per domain. It starts at most one article's image job per domain, and that job downloads its images one by one.
- The Reader host script (`apps/mobile/assets/embedded/js/react-native-host.js`) is app-owned. The bridge (`packages/reader-embed/assets/js/webview-bridge.js`) is a pinned upstream artifact. Its `ImageClickProcessor` sets `display:none` on error and reattaches `onload`/`onerror` handlers.
- `SlaxImageResources.registry` (Android) builds `File(context.cacheDir, "slax-image-transfers")` and requires `canonicalFile == absoluteFile`. On Android 17 `cacheDir` is `/data/user/0/<package>/cache`, which canonicalizes to `/data/data/<package>/cache`, so the check throws on every call and every Reader and background image fails before any request. Other Android file-store checks start from `dataDir.canonicalFile` or already canonical roots and are unaffected.
- Android pins `com.squareup.okhttp3:okhttp:4.9.2` in the platform module. React Native 0.88.1 declares okhttp and okhttp-urlconnection 4.9.2. Fresco, Glide's integration, and expo-log-box declare 3.x. The release classpath resolves all of them to 4.9.2.

## Goals / Non-Goals

Goals: one bounded diagnostic per failure family per process, seven-way background parallelism with Reader headroom, an in-place recoverable image failure, and OkHttp 5 fast fallback app-wide.

Non-goals: Cronet, HTTP/3, automatic Reader retries, a gallery placeholder, server or pipeline changes, probing article hosts.

## Decisions

### Diagnostic collector in the data runtime

A small `createNetworkDiagnostics` module in `apps/mobile/src/telemetry/network-diagnostics.ts` holds per-family state (`idle`, `probing`, `recorded`) for the process. `report(family, failure)` returns immediately. The family stays `idle` and can record later when any of these holds:

- the network snapshot is `offline`
- the failure is a cancellation
- the failure is a 4xx other than 408 or 429

Otherwise the family moves to `probing`. The module calls the native probe and captures one `kind=network` record whose `Error` is named `NetworkDiagnostic`, then marks the family `recorded`. If the probe itself throws, the family still records with the probes it has, so it stays at most once. The state is module-level per runtime instance, which matches "per app process" because the runtime lives for the process.

Hooks:

- **PowerSync**: `captureSyncFailure` reports family `powersync` for phases `connect` and `stream`. The `token` phase is an API request and `upload` is not a connection. The host is the cached sync endpoint's host. When none is cached, it uses the API host.
- **Content**: `OfflineCoordinator.getArticleContent` failures from the foreground Reader path report family `content` against the API origin. The coordinator already maps native failures to `ApiError` or `DataTransportError` with a status, so the client-error filter reads that status.
- **Image**: The Reader WebView posts `imageError`. `ReaderWebView` forwards it to the runtime, which reports family `image` against the image proxy origin. The proxy origin is the configured API origin, because `PROXY_IMAGE_PREFIX` is served there and the signed-proxy policy only admits it. Third-party direct images also report, but the probe still targets the proxy origin, so no article host is recorded.

### Native probe

`SlaxPlatform.probeNetwork(host)` is added next to `resolveDns`. It is an async function that returns a JSON-compatible map and never throws to JS for probe failures. It only accepts the host names in the reader's protected-host list, which is the existing Slax origins policy, and rejects anything else.

Android:

- System DNS through `InetAddress.getAllByName`.
- Public DNS through the existing `SlaxDns` UDP query to `1.1.1.1`. It returns A records only; AAAA is left out to keep the change small.
- TCP connects with `Socket().connect(InetSocketAddress(address, 443), 3000)` for the first address of each family.
- Network facts from `ConnectivityManager.getNetworkCapabilities` and `LinkProperties`: transports, `NET_CAPABILITY_NOT_METERED`, `isPrivateDnsActive`, and `privateDnsServerName != null`. The IPv6 route check looks for an IPv6 default route in `routes`. `ACCESS_NETWORK_STATE` is already granted through `expo-network`.

iOS:

- System DNS through `getaddrinfo` with `AF_UNSPEC`.
- Public DNS through the existing UDP query to `1.1.1.1`.
- TCP connects with nonblocking sockets and a 3 s `select`.
- Transport, VPN, and metered state through `NWPathMonitor`'s current path. Private DNS is reported as unknown. An IPv6 route is reported when the path supports IPv6.

Results report only counts, durations, and error classes. Each step has its own timeout: 3 s for system DNS, 5 s for the existing public resolver, and 3 s for each TCP connect. The JS side races the whole probe against a 10 s timer.

### Android staging root

`SlaxImageResources.stagingRoot(cacheDir)` builds the staging root under `cacheDir.canonicalFile` and keeps the existing canonical-equals-absolute and symbolic-link checks for the `slax-image-transfers` directory and everything below it. A device alias of the platform directory is accepted; a link at or below `slax-image-transfers` is still rejected. The native resource host test models the user mount with a symbolic link to the real data directory and asserts both outcomes; it fails with `Unsafe image staging root` against the previous code.

The registry and Reader resource handler also record the most recent non-cancelled image failure (HTTP status, exception class, terminal and timeout flags, never a URL) so the image diagnostic can report `image_failure`.

`SlaxResources` resolves `context.dataDir` once (`dataRoot`) for the Reader's cache path and for persisting. Otherwise a canonical cache file relative to the aliased `dataDir` becomes `../../../data/...`, and every Reader image persist fails.

### Parallel background images and registry headroom

- **Registry**: raise worker and running limits from 3 to 10, and the per-host limit from 2 to 10. Set the staging budget to `10 × 20 MiB`, so it bounds each image's size, not concurrency. Downloaded files are already streamed to disk and capped at 20 MiB each.
- **Background images**: the engine gets an image semaphore of seven permits. Android uses a `kotlinx.coroutines.sync.Semaphore` on `Dispatchers.IO`. iOS uses the existing `images` OperationQueue with `maxConcurrentOperationCount = 7` and per-image operations. `startImages` launches one child per eligible image, each acquiring a permit. Results are merged on the control thread or queue every eight completions and at the end, as before. Cancellation of the article's work cancels its children. The one-image-job-per-domain rule is relaxed so up to seven article image jobs can start. The global semaphore still caps image downloads at seven.
- **Content**: the per-domain running limit changes from 3 to 7 on both platforms.

### Placeholder and retry in the app-owned host

The host script installs a capture-phase `error` listener on `document`. Image errors do not bubble, so it uses capture, which runs before the bridge's element-level `onerror`. It also installs a `load` listener. On an `img` error with a `slaxstatic`, `slaxstatics`, `http`, or `https` source, the script:

1. Records the source in a `WeakMap` and adds the class `slax-image-failed`.
2. Sets an SVG data-URL background through a stylesheet rule. The rule uses `!important` on `display`, `width`, `min-height`, `background`, and `content` to override the bridge's `display:none`. It replaces the image with the placeholder by setting `content: url(data:image/svg+xml,...)` on the image. WebKit and Chromium both render `content: url()` on replaced elements, so the `img` node itself shows the icon and hint, and no node is inserted.
3. Sets `role=button`, `aria-label`, and `data-slax-retry` text for the locale.
4. Posts `{type: 'imageError', src}` at most once per source.

A capture-phase `click` on `.slax-image-failed` stops propagation, so the bridge's gallery click and the host's tap message don't run. It moves the image to `slax-image-retrying` with a loading background, then reassigns `src` to the same value with a `#slax-retry-<n>` fragment. Signed proxy URLs reject unknown query keys, so the retry cannot use a query parameter. Changing only the fragment still makes the WebView issue a fresh request. Android's `shouldInterceptRequest` and iOS's `WKURLSchemeTask` deliver the custom-scheme URL including its fragment, and both platforms' signed-proxy checks reject fragments. So each native intercept strips exactly a trailing `#slax-retry-<digits>` (`SlaxReaderSecurity.withoutRetryMarker`) before the policy, cache-key and download steps. Any other fragment is still rejected. The bridge strips the same marker from gallery and image-action sources.

On `load` the script removes the failed classes. The bridge's own `onload` then runs its normal size and click handling, because the bridge reassigns its handlers on every processor pass and the host never replaces them. The long-press handler ignores `.slax-image-failed` and `.slax-image-retrying` images.

The locale comes from the host configuration's new `locale` field, set by `composeReaderDocument` from the app locale.

### OkHttp 5.5.1 via BOM

The platform module declares `implementation platform('com.squareup.okhttp3:okhttp-bom:5.5.1')` and `implementation 'com.squareup.okhttp3:okhttp'`. It also adds `okhttp-urlconnection` as `runtimeOnly` under the same BOM, so React Native's `okhttp3.JavaNetCookieJar` resolves to the 5.x delegate. Gradle's highest-version conflict resolution raises the other declarations to 5.5.1. The app sets `okHttpVersion=5.5.1` in `gradle.properties`, through the owned config plugin, so expo-image declares the same version.

Binary compatibility was checked against the 5.5.1 artifacts:

- `okhttp3.JavaNetCookieJar(CookieHandler)` remains in `okhttp-urlconnection`.
- `okhttp3.internal.http.HttpHeaders.promisesBody(Response)`, used by Expo fetch and expo-updates, remains.
- Okio 3.18.1 is source and binary compatible with the 3.16 already resolved.

App-owned Kotlin uses only stable OkHttp APIs, such as `Request.Builder`, `OkHttpClient.Builder`, `Response.body`, and `toRequestBody`. In 5.x `Response.body` is non-null, so existing null checks compile with a warning. Fast fallback is default-on.

The native host tests resolve OkHttp and Okio jars from the Gradle cache by version. They move to `okhttp-jvm` 5.5.1 and `okio-jvm` 3.18.1, and okhttp-jvm 5.x needs kotlin-stdlib 2.1+ at runtime, which the tests already supply from `kotlinc -include-runtime`.

## Risks / Trade-offs

- **App-wide OkHttp major upgrade.** Mitigation: binary checks above, a Release build, and device exercise of login cookies, Fresco images, expo-image avatars, Expo fetch, updates, and Reader images. Reverting the BOM restores 4.9.2.
- **More parallel connections.** Ten image connections to one proxy host over HTTP/2 share one connection with OkHttp and URLSession. Over HTTP/1.1 they open more sockets. The server already serves browsers with higher parallelism.
- **Seven content requests per domain.** This can raise burst load on `/v1/bookmark/content` for users with large libraries. Content requests are authenticated, bounded by the plan, and were already parallel at three. The API has no per-route rate limit on this path.
- **`content: url()` on `img`.** This is supported by Chromium WebView and WebKit, but not specified for replaced elements in older engines. The app's floors (Android API 26 WebView updates, iOS 16.4) support it. If it doesn't render, the image keeps a visible gray box with its alt text, and tap to retry still works.
- **Diagnostic probes use the network after a failure.** They are bounded to once per family per process and about ten seconds.

## Migration Plan

This ships through the normal Mobile release with a version decision. No server, schema, or pipeline change is needed. Revert by restoring the limits, the host script, and the 4.9.2 dependency.
