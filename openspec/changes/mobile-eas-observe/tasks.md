# Tasks

## 1. Dependency and composition boundary

- [x] 1.1 Install the SDK 57-compatible `expo-observe` package in `apps/mobile/package.json` and update `pnpm-lock.yaml`; verify `pnpm install --frozen-lockfile` succeeds.
- [x] 1.2 Create `apps/mobile/src/observe/index.ts` with one `Observe.configure` call, the React Navigation integration options, filtered route parameters, debug/fixture dispatch disabled, the wrapped root export, `ObserveNavigationContainer`, and the `useObserveMarkInteractive` hook; verify the module type-checks and has no dependency on screens or runtime services.
- [x] 1.3 Wrap the product root in `apps/mobile/src/App.tsx` and replace the top-level `NavigationContainer` with the Observe navigation container while preserving the existing `navigationRef`; verify the existing route reporting callback still receives the same ref.

## 2. Route readiness instrumentation

- [x] 2.1 Mark interactive in `LoginScreen` and `ReauthenticateScreen` after their first interactive render; verify the marker is called once per navigation and does not run before the screen is mounted.
- [x] 2.2 Mark interactive in `LibraryScreen` when the initial list state is renderable, including legitimate empty and error states, without waiting for PowerSync, credential refresh, or automatic cache work; verify the marker is not tied to sync completion.
- [x] 2.3 Mark interactive in `ReaderScreen` when the document is ready or the normal error UI is interactive, without waiting for background synchronization; verify the marker is not called while the document is still loading normally.
- [x] 2.4 Verify fixture and debug builds dispatch no production Observe events, and that existing Firebase Analytics, Crashlytics, and `MobileTelemetry` calls are unchanged.

## 3. Test isolation and coverage

- [x] 3.1 Add default `expo-observe` and `expo-observe/integrations/react-navigation` boundaries to `apps/mobile/tests/reader/parity-host.mjs` and every local loader that imports `src/App.tsx`; verify the existing UI suites still load the real product root without a native Observe module.
- [x] 3.2 Add host tests proving the product renders when Observe is a no-op, `Observe.configure` receives the expected filtered parameters, and `ObserveNavigationContainer` forwards the existing navigation ref.
- [x] 3.3 Add route-readiness tests for Login, Library, Reader, and Reauthenticate; verify each marker fires at the intended state and not during unrelated background work.

## 4. Share extension archive isolation

- [x] 4.1 Keep the `with-share.cjs` target-level `CC`, `CXX`, `LD`, and `LDPLUSPLUS` settings and verify `node --test native/share/tests/plugin.test.cjs` passes, including the new clang assertions.
- [x] 4.2 Regenerate the committed iOS project through the supported prebuild workflow with operator inputs present; verify only the share target settings and expected generated metadata change, and that the main Firebase/Pods integration is preserved.
- [ ] 4.3 Run a native iOS archive with ccache enabled and verify the `SlaxShare` target links without resolving `/../../../../node_modules/.../ccache-clang.sh`; record the operator/native evidence separately from unit tests.

## 5. Documentation and checks

- [x] 5.1 Document EAS Observe setup, the EAS project requirement, anonymous identity, filtered parameters, Free-plan event quota, data retention, native-build requirement, and the distinction from Firebase/Crashlytics in the mobile documentation.
- [x] 5.2 Run `pnpm mobile -- check`, `pnpm mobile -- bundle`, `npx openspec validate --all --strict`, and `git diff --check`; resolve failures before handing off.
- [x] 5.3 Ask the human whether to increment `apps/mobile/package.json` version/build metadata, including `buildNumber` and `previousBuildNumber`; do not change version metadata until explicitly approved.

## 6. Native delivery verification

- [ ] 6.1 Build and install a new release binary containing `expo-observe` and the share-target fix; verify cold/warm launch, Library, Reader, and reauthentication metrics appear in the EAS Observe dashboard and no fixture/debug telemetry is dispatched.
- [ ] 6.2 Verify the dashboard/CLI reports the expected runtime version and route metrics (`eas observe:versions`, `eas observe:metrics-summary`, `eas observe:routes`), and record any unavailable checks as pending rather than passed.
- [x] 6.3 Confirm that no EAS Build migration, backend deployment, signing/upload, or store publication was performed without separate authorization.
