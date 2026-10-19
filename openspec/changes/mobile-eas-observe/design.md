# Design

## Context

See `proposal.md` for motivation. The product root is `apps/mobile/src/App.tsx`, which registers `ApplicationRoutes` inside `MobileProvider`; `apps/mobile/index.ts` selects product or fixture roots before `registerRootComponent`. The app uses React Navigation 7 dynamic configuration with a shared `navigationRef` and `createNativeStackNavigator`. Existing telemetry lives in `apps/mobile/src/telemetry/` and uses Firebase Analytics/Crashlytics plus first-party client events. The repository already has an EAS project id in `app.config.ts`.

The production archive failure comes from the generated `SlaxShare` target. The project-level `REACT_NATIVE_PATH` is expressed relative to `PODS_ROOT`; when ccache is enabled, React Native's post-install script also sets project-level `CC`, `LD`, `CXX`, and `LDPLUSPLUS` to `$(REACT_NATIVE_PATH)/scripts/xcode/ccache-clang*.sh`. `SlaxShare` is a standalone app extension with no CocoaPods target and therefore no `PODS_ROOT`, so the path becomes `/../../../../node_modules/...` and the linker cannot spawn it.

## Goals / Non-Goals

**Goals:**

- Add production performance telemetry without changing startup, authentication, reading, synchronization, or existing telemetry behavior.
- Measure usable route readiness, not merely component mount or full background synchronization.
- Keep sensitive route parameters and document content off the telemetry path.
- Keep the existing Firebase Analytics/Crashlytics and first-party collectors authoritative.
- Make the `SlaxShare` target build independently of Pods-only ccache variables while preserving the ability to enable ccache for the main application and Pods.
- Keep tests deterministic without a native Observe module.

**Non-Goals:**

- No replacement for Firebase Analytics, Crashlytics, or the first-party event pipeline.
- No EAS Build migration, EAS Update rollout, backend deployment, signing change, or store publication.
- No per-page or per-module OTA delivery; Observe is performance telemetry only.
- No observe instrumentation of fixture applications or production dispatch from debug builds.
- No changes to the share extension's sources, identity, App Group, or Firebase-free status.

## Decisions

### Isolate Observe behind one composition module

Add `apps/mobile/src/observe/index.ts` as the only module that imports `expo-observe` and the React Navigation integration. It will:

- call `Observe.configure` once at module scope, before any screen mounts;
- export `ObserveRoot.wrap`/the wrapped root helper, `ObserveNavigationContainer`, and a `useObserveMarkInteractive` hook;
- set `dispatchInDebug: false` so debug/fixture builds do not send production metrics;
- filter all user-bearing route parameters (`bookmarkId`, `collectionId`, `collectionOwnerId`, `rssEntryId`, `title`, `targetUrl`, `openedFrom`, `entryPoint`) and leave only the route name for aggregation;
- keep any best-effort Observe call inside a guard so a telemetry failure cannot propagate into product behavior.

`src/App.tsx` imports this module, exports the Observe-wrapped product root, and uses `ObserveNavigationContainer` in place of `NavigationContainer`. The existing `navigationRef` is passed through unchanged.

Alternative considered: call the SDK directly from screens and `App.tsx`. Rejected because it spreads a native/third-party dependency across composition and presentation, makes test isolation harder, and makes later removal or replacement noisy.

### Use the React Navigation integration rather than manual route events

The app already has one navigator and a shared ref, which matches the integration's dynamic-configuration path. `ObserveNavigationContainer` forwards the same ref, so route reporting and deep links keep working. The integration supplies cold/warm first-render and interactive timings per route; the existing `reportRoutes` analytics remains separate.

Alternative considered: log a custom Observe event from `reportRoutes`. Rejected because it would not measure render or interactive readiness.

### Mark interactive at route-specific readiness

- `Login` and `Reauthenticate`: after the screen's first interactive render.
- `Library`: when the initial list state is renderable (including a legitimate empty or error state), not when PowerSync or automatic cache work finishes.
- `Reader`: when the document is ready or the normal error UI is interactive, not when background synchronization finishes.

The first entry-screen marker defines app-wide TTI. Later route markers define route TTI. This keeps the metric truthful: a user can interact with the shell before sync completes, and Reader readiness is distinct from the app-wide first entry.

Alternative considered: mark on every screen mount. Rejected because it would report mount time as interactivity and would make Reader look fast while its document is still loading.

### Keep existing telemetry authoritative

Firebase Analytics, Crashlytics, and `MobileTelemetry` continue to own product events and crash reporting. Observe adds performance data and, while in preview, optional JS/native error visibility. Crashlytics remains the crash-reporting source because Observe's native crash stack traces are not symbolicated in the dashboard.

### Give the share target explicit clang settings

Modify `apps/mobile/plugins/with-share.cjs` so `configureIosTarget` sets target-level `CC=clang`, `CXX=clang++`, `LD=clang`, and `LDPLUSPLUS=clang++` for both Debug and Release. The share target is pure Swift and does not use React Native headers or Pods, so it does not need ccache. Target-level settings override the project-level ccache wrappers even after `pod install`. Regenerate the committed iOS project through the plugin and add assertions to the existing share-plugin test.

Alternatives considered:

- Set `PODS_ROOT` on the share target. Rejected because it introduces a CocoaPods-only variable into a non-Pods target and leaves the extension coupled to Pods layout.
- Disable ccache globally. Rejected because it slows the main app and Pods and does not fix the underlying target inheritance problem.
- Hand-edit `project.pbxproj` only. Rejected by the repository's generated-project rule; the source plugin must own the change.

### Test isolation

The host test loader asserts explicit boundaries for non-relative imports. Add a default `expo-observe` boundary and a `expo-observe/integrations/react-navigation` boundary to `tests/reader/parity-host.mjs` and to the local loaders that import `src/App.tsx`. The default boundary provides `Observe.configure`, `ObserveRoot.wrap`, `useObserve().markInteractive`, and an `ObserveNavigationContainer` that forwards props/ref to the test `NavigationContainer`. Add tests that the product renders when Observe is a no-op and that configured sensitive route parameters are filtered.

## Risks / Trade-offs

- **Observe native module missing from an OTA target** → ship it only in a new native build with a matching runtime version; do not publish JS that imports it to an older binary.
- **Event quota/cost** → instrument only the four entry routes, keep per-route navigation metrics enabled, monitor the Free-plan 100K events/month allowance, and do not add screen-level events for every route.
- **Privacy leakage through route parameters** → filter every user-bearing route parameter in one central configuration; keep document content and credentials out of Observe events.
- **Telemetry failure affects startup** → keep Observe initialization best-effort and outside startup admission; no product state depends on Observe success.
- **Prebuild without operator Firebase inputs removes main-app integration** → regenerate with the operator inputs present, inspect the diff, and never commit a Firebase-less native project.
- **Archive fix verification** → the ccache path can only be exercised in a native archive with ccache enabled; record the operator/native result separately from unit tests.
- **Watchdog/overhead** → Observe is best-effort; markInteractive is called once per entry route and does not gate rendering.

## Migration Plan

1. Add `expo-observe` and the composition module.
2. Wrap the product root, switch the navigation container, and instrument the four entry routes.
3. Update host tests and share-plugin tests.
4. Regenerate native projects with operator inputs and run pods.
5. Run mobile checks and bundle validation; build a new native release and verify Observe metrics on a real release build.
6. If rollback is needed, remove the JS instrumentation and rebuild natively; the native module can remain installed without dispatching metrics.

No backend or synchronized-data migration is required.
