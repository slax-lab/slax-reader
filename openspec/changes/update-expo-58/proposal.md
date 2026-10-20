# Proposal

## Why

Mobile needs a verified Expo SDK 58 foundation before adding system entry points and adaptive reading. The upgrade changes native templates, lifecycle delivery, types, and release optimization; combining those changes with new native features before both platforms build would make regressions difficult to isolate.

## What Changes

- Use `feat/mobile-perf@960ccb57bc89796d9063e0a41e83b4a766628161` as the user-selected temporary development baseline, in an independent worktree and `feat/update-expo-58` branch (renamed from `feat/mobile-sdk58-native-experiences` at the human’s delivery request). Do not merge, modify, or wait for other mobile branches.
- Complete board items **1–10 and 12**, in gated stages. **Item 11 (audio/TTS/lock-screen playback) is excluded.** Item 12 is an adaptive PDF prototype, not a replacement for ordinary reading.
- Upgrade Expo 57/RN 0.86 to SDK 58 and its supported dependency set; align React, React DOM and React types, repair native plugins, regenerate native projects, and verify Android and iOS builds before adding feature dependencies.
- Repair strict TypeScript and the existing Node/mounted-host harness without weakening assertions. Re-measure the reported 55 type errors and 185 test failures against the actual upgraded tree rather than treating old counts as current results.
- Preserve login, Firebase main-app bootstrap, Firebase-free Share, purchases, native back, HTML/PDF reading, selection, offline synchronization, cached images, and the baseline performance fixes.
- Add one iOS Siri/Shortcuts save-URL path, then an App Intents MVP with account-scoped pending invocation handling, a bounded Spotlight catalog, and successful-action donations.
- Add iOS/Android widgets for a small reading queue and unread count, plus a local, explicitly started iOS reading-session Live Activity prototype.
- Add an opt-in adaptive two-page PDF.js layout for supported Duo/window geometries, retaining the existing single-WebView document owner, single-page fallback and PDF data/security boundaries. Respect measured all-edge scene safe bounds across Inbox, drawer, Reader and anchored menus during posture changes. Use `expo-hinge` for optional pose effects; `@expo/ui` remains scoped to widget/Live Activity UI.

## Capabilities

### New Capabilities

- `mobile-sdk58-upgrade`: Staged SDK upgrade acceptance, reproducible native generation, release-signing protection, and regression gates.
- `mobile-system-actions`: Save-URL intents, durable processing, safe system indexing, donations, and entry routing.
- `mobile-reading-widgets`: Account-scoped reading snapshots, widgets, and reading-session Live Activity lifecycle.
- `mobile-adaptive-pdf-reading`: Opt-in adaptive PDF spreads, document coordinates, and supported-platform fallback.

### Modified Capabilities

None under `openspec/specs/` on the selected baseline. `mobile-expo-runtime` currently exists in the historical, unarchived `expo-mobile-migration` change: this proposal intentionally supersedes its SDK 57 pin for this upgrade, while preserving platform floors and other runtime obligations. It does not edit that change or the active performance changes. If canonical mobile specs are introduced before this task merges, reconcile the runtime pin in this task's delta before merge, without coordinating other branches as a prerequisite.

## Impact

Affected areas include `apps/mobile/package.json`, `pnpm-lock.yaml`, config plugins, native generation/build tooling, app-owned Swift/Kotlin modules, existing feature controllers and tests, and mobile documentation. Proposed optional integrations are `expo-app-intents` (alpha; Swift declarations and native queue), `expo-widgets` (widget/Live Activity targets), `@expo/ui` (native widget/adaptive layouts), and `expo-hinge` (availability-gated pose input). Proposal approval must explicitly cover these packages before installation; no new test framework, navigation framework, audio package, or API/schema change is proposed.

Planning retained `1.0.25`, build `772`, previous `771`. At delivery, the human explicitly approved `1.0.25 (774)` with `previousBuildNumber: 773`; 773 is the prior source-build bound from the latest `origin/dev`, not independently verified store publication history. Regenerate native metadata through the existing tooling and validate consistency before Git delivery. Native verification is local; store publication and remote deployment are outside this task.
