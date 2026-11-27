# Tasks

## 1. Network diagnostics

- [x] 1.1 Add `probeNetwork(host, allowed)` to the Android and iOS platform modules, returning bounded DNS, TCP and network facts and the last native image failure, without IP addresses. Verify it rejects hosts outside the allowed suffixes and completes within its timeouts.
- [x] 1.2 Add the per-process, per-family diagnostic collector and hook it into PowerSync connect/stream failures, foreground article content failures and Reader image failures. Verify one record per family, offline and client-error suppression, and that failures in probing never reach callers.

## 2. Background concurrency

- [x] 2.0 Resolve the Android platform cache directory before the image staging-root check so the `/data/user/0` alias no longer rejects every download, keep rejecting links below it, and record the last non-cancelled image failure for diagnostics. Verify with a native resource host case that fails against the previous check.

- [x] 2.1 Raise the shared image registry to ten concurrent downloads, ten per host, with a per-image staging budget, and the iOS Reader image workers to ten, on both platforms. Verify deduplication, cancellation and streaming retention in the native registry hosts.
- [x] 2.2 Download one article's background images in parallel under a global limit of seven, allow multiple article image jobs, serialize manifest merges, and raise per-domain content concurrency to seven, on both platforms. Verify the offline engine hosts still pass and that a merge cannot regress an image state.

## 3. Reader image placeholder

- [x] 3.1 Mark failed Reader images in the app-owned host script with an in-place placeholder, tap to retry through a fragment-changed source, locale text and accessibility role; suppress the toolbar tap, gallery click and long press on placeholders; post one `imageError` per source. Regenerate the embedded assets.
- [x] 3.2 Parse `imageError` in the bridge, strip retry fragments from gallery and long-press sources, forward image failures to the diagnostic collector, and pass the locale to the document. Verify with host-script and bridge tests.

## 4. OkHttp 5

- [x] 4.1 Align Android on the OkHttp 5.5.1 BOM in the platform module and move the native host tests' classpaths to okhttp-jvm 5.5.1 and okio-jvm 3.18.1. Verify the resolved release runtime classpath has one OkHttp 5 version for every artifact.

## 5. Verification and review

- [x] 5.1 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, the native resource and registry host tests, and `openspec validate --all --strict`.
- [x] 5.2 Build and install Android on a device and exercise: Reader images on an image-rich article, a forced image failure showing the placeholder and a successful retry, a highlighted image, background caching parallelism, an offline open, login/session cookies, avatars and an update check; capture the diagnostic records in the test pipeline or the device log. Record results and gaps in `validation.md`.
- [x] 5.3 Obtain the change requester's hands-on acceptance of the Reader placeholder and the Mobile version decision, complete the local Bugs, Security and Compliance review, and open the pull request against `dev`.
