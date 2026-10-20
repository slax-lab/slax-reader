# SDK 58 Widget Routing Notes

Scope: read-only API/source review for OpenSpec task 10.3. This note records implementation boundaries, not native acceptance.

## Android

`expo-widgets@58.0.20` supports Android home-screen widgets when its config plugin has `enableAndroid: true` (default `false`). The plugin generates a Glance provider subclass and receiver metadata. Its generated click action is a broadcast handled by `ExpoWidgetsAppWidgetProvider`; that handler updates widget props, reloads the widget, and emits a process-local JS interaction event. It does not launch the main Activity. The interaction listener therefore cannot alone satisfy cold-start routed entry.

Use an app-owned Android `RemoteViews` provider as the platform routing adapter, with an explicit `PendingIntent` to the existing main Activity carrying an opaque internal bookmark route. Process that route through the approved common entry adapter, which performs current-owner and visibility admission before opening content. This is the task's routed-entry implementation choice; it does not add a feature. Do not copy or intercept expo-widgets' private broadcast. Keep widget display data within the approved atomic, owner-scoped snapshot boundary; verify the public snapshot handoff before implementation. Generate the provider and manifest through the app-owned config plugin, not by patching dependencies or hand-editing generated native files.

## iOS and package APIs

The SDK 58 docs expose `createWidget`, `updateSnapshot(props)` and iOS-only `updateTimeline(entries)`. Widget layouts run in an isolated synchronous context. `addUserInteractionListener` is only a running-process notification. The public `@expo/ui/swift-ui` `Link` accepts a destination URL, but the reviewed docs/source do not establish that it routes from a widget into the app; verify that by native build and an actual widget tap before claiming task 10.3 acceptance.

`createLiveActivity` is iOS-only. The expo-widgets plugin generates the activity/widget target and App Group integration; push notifications and frequent updates default off. Task 10.4/10.5 still require supported-target behavior checks.

## Sources

- [Expo Widgets, SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/widgets/)
- Public package metadata/source: `expo-widgets@58.0.20`, notably `plugin/build/withWidgets.d.ts`, `plugin/build/withWidgets.js`, `plugin/build/android/withAndroidWidgetFiles.js`, `android/src/main/java/expo/modules/widgets/WidgetInteractionAction.kt`, and `ExpoWidgetsAppWidgetProvider.kt`.
- Public package source: `@expo/ui@58.0.20`, `src/swift-ui/Link/index.tsx`.
- Approved scope: `openspec/changes/update-expo-58/tasks.md`, task 10.3; `design.md`, “Widgets consume snapshots; activities model a finite reading session”.
