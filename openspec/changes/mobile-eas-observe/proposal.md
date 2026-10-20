# Proposal

## Why

Mobile currently has production Firebase Analytics/Crashlytics and first-party product events, but no production performance telemetry: real-user cold/warm launch, time to first render, time to interactive, bundle load, per-route timing, and EAS Update download behavior are invisible. The user requested EAS Observe to close that gap. Separately, production EAS archives fail on the `SlaxShare` extension because the non-Pods extension target inherits the project-level ccache compiler/linker wrapper, whose `REACT_NATIVE_PATH` depends on `PODS_ROOT`; with no `PODS_ROOT`, the wrapper resolves to the invalid path `/../../../../node_modules/.../ccache-clang.sh`.

## What Changes

- Add the user-approved `expo-observe` native dependency (SDK 57-compatible) as an additive production performance telemetry integration.
- Wrap the product root and enable the React Navigation integration so release builds report startup metrics and per-screen cold/warm render and interactive timings.
- Mark interactive on the defined entry screens (`Login`, `Library`, `Reader`, `Reauthenticate`) without blocking startup, sync, or reading.
- Preserve Firebase Analytics, Crashlytics, and first-party `MobileTelemetry`; Observe is additive and must never become a dependency for startup, login, reading, or sync.
- Keep fixture/debug builds from dispatching production metrics and filter sensitive route parameters.
- Fix the `SlaxShare` archive failure by giving that target its own standard clang compiler/linker settings instead of inheriting Pods-only ccache wrappers; regenerate the committed iOS project through the existing config plugin.
- Require a new native build for Observe and the archive fix; neither can be delivered by an OTA-only update.

## Capabilities

### New Capabilities

- `mobile-observability`: Production performance telemetry through EAS Observe, including startup, per-route navigation, update-download metrics, privacy boundaries, fixture isolation, and coexistence with existing telemetry.

### Modified Capabilities

- `mobile-expo-runtime`: Add the build invariant that the non-Pods `SlaxShare` target must not inherit ccache wrappers that depend on `PODS_ROOT`, so production archives are reproducible with or without ccache enabled.

## Impact

- `apps/mobile/package.json`, `pnpm-lock.yaml`, and regenerated native projects through the supported prebuild workflow.
- `apps/mobile/src/App.tsx`, a new `apps/mobile/src/observe` composition module, entry-screen instrumentation, and existing telemetry remains unchanged.
- `apps/mobile/plugins/with-share.cjs`, `apps/mobile/ios/SlaxReader.xcodeproj/project.pbxproj`, and the share plugin tests.
- Existing unit/mounted-host suites and mobile documentation.
- No backend endpoint, synchronized schema, application identity, signing identity, EAS Build migration, deployment, or store publication change.
