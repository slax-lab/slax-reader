# Mobile observability

The mobile application reports production performance metrics through [EAS Observe](https://docs.expo.dev/eas/observe/introduction/). Observe is additive to the existing Firebase Analytics, Crashlytics, and first-party `MobileTelemetry` collectors; it is not a product-analytics or crash-reporting replacement.

## What is collected

- Cold and warm launch, time to first render, time to interactive, and bundle load.
- Per-route cold/warm first render and interactive timing for `Login`, `Library`, `Reader`, and `Reauthenticate`.
- EAS Update download timing for builds that embed `expo-updates` once an update is published to their runtime (see [release](release.md#over-the-air-javascript-updates-eas-update)).
- Optional user-defined events and preview JS/native error reporting only when explicitly added.

The app marks interactive when the entry route is usable: Login and Reauthenticate after their first interactive render, Library when the initial list state is renderable (including a legitimate empty or error state), and Reader when the document is ready or the normal error UI is interactive. Full PowerSync synchronization and automatic cache completion are not prerequisites. Each screen mount marks interactive at most once; returning to a still-mounted screen is reported through `warm_ttr`, not a second interactive marker.

## Configuration

`apps/mobile/src/observe/index.ts` is the only module that imports `expo-observe`. It configures the React Navigation integration once before mount, disables debug dispatch, and filters user-bearing route parameters:

- `bookmarkId`, `collectionOwnerId`, `collectionId`, `rssEntryId`, `title`, `targetUrl`, `openedFrom`, `entryPoint`.
- Route names remain available for aggregation.
- No credentials, tokens, article/document content, or unfiltered sensitive parameters are sent.

`src/App.tsx` wraps the product root with `ObserveRoot` and uses `ObserveNavigationContainer` with the existing `navigationRef`. Entry screens call `useObserveMarkInteractive()` at their defined readiness point. Controlled fixtures and debug builds do not dispatch production metrics. If the SDK throws an `[expo-observe]` error, the root and navigation container fall back to their plain equivalents; any other render error still propagates to the app's boundaries.

## Prerequisites and build

Observe requires an EAS project. The project id already lives under `extra.eas.projectId`; the EAS account used for builds must have access to it.

`expo-observe` is a native module, so it cannot be delivered by an EAS Update. After changing the dependency:

```sh
pnpm mobile -- prebuild
pnpm mobile -- pods
```

Regenerate with the operator Firebase inputs present, inspect the native diff, and build a new native release. `expo-observe` uses anonymous installation identifiers and retains metrics for at least 90 days.

## Plan limits

The Free plan includes 100,000 events per month (roughly 10,000 monthly active users); paid plans include 500,000. Beyond the included allowance, Observe is billed per event. Per-route navigation instrumentation increases event volume, so monitor the EAS usage page and reduce entry-route instrumentation if the included allowance is approached.

## Verification

Build and install a release binary, then open the project's Observe tab or query it with EAS CLI:

```sh
eas observe:versions
eas observe:metrics-summary
eas observe:routes
```

Verify cold/warm launch, the four entry routes, and that a fixture/debug build does not dispatch production metrics. Native dashboard acceptance is separate from unit tests and bundle checks.

## Share extension archive isolation

The standalone `SlaxShare` target is not a CocoaPods target and has no `PODS_ROOT`. The `with-share` config plugin therefore gives the target its own standard clang settings (`CC`, `CXX`, `LD`, `LDPLUSPLUS`) so it does not inherit the project-level ccache wrapper whose path depends on `PODS_ROOT`. Keep ccache available for the main app and Pods; do not remove this target-level isolation.

## Existing telemetry

Firebase Analytics, Crashlytics, and `MobileTelemetry` remain authoritative for product events and crashes. Observe error reporting is in preview and its native crash stack traces are not symbolicated, so Crashlytics remains the crash-reporting source.
