# Proposal

## Why

An Android 1.0.31 user reported that saved articles show no images and the app loads slowly, while the same account in the phone browser loads the same articles quickly on the same network. Production evidence could not explain it:

- The article had parsed successfully.
- Android 1.0.31 had no client error reporting.
- The Worker logs held no image-proxy record for the session.

Exercising the Android Reader on a Pixel 9 Pro Fold (Android 17) found the direct cause: the shared native image registry refused to start, so no Reader or background image was ever downloaded. Android reports `cacheDir` as `/data/user/0/<package>/cache`, a per-user mount that canonicalizes to `/data/data/<package>/cache`. The registry's staging-root check compared the canonical and absolute paths of `cacheDir/slax-image-transfers` and threw `Unsafe image staging root` on every attempt, so uncached Reader images showed nothing and background image acquisition never succeeded. The check arrived in `d033836a` (2026-10-15), which every Android build from 1.0.25 (768) through 1.0.35 (810) contains; iOS is unaffected. Over 2026-10-28 to 2026-11-28 UTC the business event lake recorded 150 users on 308 Android devices running those builds (48 users on 75 devices in the last seven days). The browser loads the same images directly, so it was unaffected.

Reading the code also found contributing client-side causes. The Android and iOS Reader and the background cache share one native image queue. That queue downloads at most two images per host at once, and every article image goes through the same proxy host. The queue's 60 MiB staging budget, at 20 MiB per image, also caps it at three concurrent downloads in total. Background acquisition downloads one article's images one at a time. A download that does not finish within 30 seconds is dropped without a retry. The Reader script then hides the failed image, so the user sees a missing image instead of an error. Android uses OkHttp 4.9.2, which has no IPv4/IPv6 fast fallback. When the IPv6 route to the edge stalls, OkHttp waits out a full timeout before trying IPv4, and browsers do not.

The change requester asked for four changes:

- A one-time network diagnostic when downloads fail.
- Seven concurrent background downloads.
- A visible failed-image state with tap to retry.
- A network library upgrade.

## What Changes

- **Android image staging root.** The registry resolves the platform cache directory first and then rejects only a link or alias below it, so the `/data/user/0` user mount no longer blocks every image download. iOS resolves paths through Foundation, which reports app-container paths without the `/private` prefix, and needs no change.

- **Network diagnostic record.** When a Reader image download, an article content download, or a PowerSync connection fails while the device is online, the app records one `kind=network` client error named `NetworkDiagnostic`. The record includes bounded network facts:
  - DNS answers for the failing Slax host from the system resolver and from `1.1.1.1`, with timings
  - TCP connect timing to that host on port 443 over IPv4 and IPv6
  - transport type, VPN state, private DNS state, IPv6 default-route availability, and metered state
  - the failure's status or exception class

  Each of the three failure types is recorded at most once per app process. Failures while offline are not recorded and do not use up that one record. Only Slax-owned hosts are probed. No IP address of the device is recorded. Article hosts are never recorded, because image failures are probed against the image proxy.
- **Background download concurrency.** Background acquisition runs up to seven concurrent article-content requests per cache domain (personal or collection) and up to seven concurrent images. It used to run three content requests per domain and one image at a time. The shared native image registry admits ten concurrent downloads, up to ten per host, so an open Reader still has three slots that background work cannot fill. The staging budget is per-image only, so concurrency is no longer silently capped at three.
- **Failed-image placeholder with tap to retry.** When a Reader article image fails to load, it stays in place as an inline placeholder that shows a broken-image icon and a retry hint. Tapping it reloads that image once. A successful retry restores the original image, its size handling, and its gallery tap. The placeholder does not add or remove document nodes, so stored highlight paths still resolve. Long-pressing the placeholder does not open image actions.
- **OkHttp 5.** Android's OkHttp family is aligned on 5.5.1 for the whole app through the platform module's BOM. This turns on OkHttp's IPv4/IPv6 fast fallback, and it also applies to the React Native networking layer, Fresco, expo-image, Expo fetch, and expo-updates. iOS keeps URLSession, which already falls back between address families.

## Capabilities

### New Capabilities

- `mobile-network-diagnostics`: the one-per-process network diagnostic records for image, content, and PowerSync failures.
- `mobile-reader-image-delivery`: background image and content download concurrency, Reader capacity reserved from background work, the failed-image placeholder and retry, and the Android HTTP client baseline.

### Modified Capabilities

None. `client-error-logs` is still an active, unarchived delta in `client-error-diagnostics` and `powersync-telemetry-direct-lake`. This change does not modify it. It adds a new record type through the existing collector.

## Impact

- `apps/mobile/modules/slax-platform` (Android and iOS):
  - the network probe function
  - the image registry's concurrency and budget
  - per-article parallel background image acquisition
  - the content concurrency limit
  - the Reader image failure signal
  - the OkHttp 5.5.1 BOM
- `apps/mobile/src`:
  - the diagnostic collector in the data runtime
  - Reader image-failure forwarding
  - bridge parsing of the new event
- `apps/mobile/assets/embedded/js/react-native-host.js` and the generated reader embedding: the placeholder and retry.
- Native host tests: classpaths for OkHttp 5.5.1 and Okio 3.18.1.
- UI-visible: the Reader image failure state on Android and iOS.
- Mobile ships this code. On 2026-11-27 the change requester approved the version increment to `1.0.36 (811)`, previous build 810.

## Non-goals

- Cronet or HTTP/3 on Android. Changing the image proxy, the API, or Cloudflare configuration.
- Retrying failed images automatically in the Reader. Showing a placeholder for images that fail inside the fullscreen gallery.
- Changing the shared `client_errors.errors` schema or the ingestion pipelines.
- Probing third-party article hosts, or recording the device's IP addresses.
