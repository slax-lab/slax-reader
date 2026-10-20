# Proposal

## Why

The current Mobile system-surface coordinator treats a temporary loss of publication readiness as an explicit opt-out. When the app enters the background, `CredentialReadiness` pauses, `surfacesReady` becomes false, and `SystemSurfacesController.reconcile(false, false)` deletes the published Spotlight catalog and all donations. Opening Shortcuts or Spotlight therefore shows an empty article list and no suggestions even though the account has eligible bookmarks and both settings are enabled.

The same flow also delays native App Intents registration inside an asynchronous `Task`, and the discoverable open action does not conform to `OpenIntent`, so Spotlight cannot hand a tapped entity to the app.

## What Changes

- Separate the user's persisted discovery/donation preferences from whether the app is currently ready to publish. A transient background or credential pause SHALL stop publication without revoking entries that are still valid for the active owner.
- Revoke the catalog and donations only when the user explicitly disables the integration, signs out, or the account/API origin changes.
- Resume publication when preferences, session, native ownership, upgrade state and credentials are ready again.
- Register the indexed entity and donation intent synchronously during `AppIntentsSetup.OnCreate`, before JavaScript can publish or donate.
- Make `OpenBookmarkIntent` conform to `OpenIntent` so a Spotlight result opens its entity through the existing `openBookmark` route.
- Add regression tests for background readiness loss, explicit opt-out, sign-out/owner replacement, donation persistence and resumption.
- Bump the Mobile release build from `776` to `777` for the authorized TestFlight delivery.

## Capabilities

### New Capabilities

- `mobile-system-surface-persistence`: Published Spotlight catalog and donations survive transient readiness loss and revoke only on explicit user or account intent. The open intent receives Spotlight entities, and native registration precedes JavaScript publication/donation.

### Modified Capabilities

None. `mobile-system-actions` remains owned by the unarchived `update-expo-58` change; this change does not add a competing delta for that capability.

## Impact

- Mobile runtime/controller: `apps/mobile/src/runtime.tsx`, `apps/mobile/src/system-actions/system-surfaces.ts`, `apps/mobile/src/system-actions/adapters.ts`.
- App-target Swift: `apps/mobile/app-intents/AppIntentsSetup.swift`, `apps/mobile/app-intents/OpenBookmarkIntent.swift`.
- Tests: `apps/mobile/tests/system-actions/system-surfaces.test.mjs` and any host checks covering the surfaces controller.
- Release metadata: `apps/mobile/package.json` (`1.0.25`, build `777`, previous `776`) and regenerated native metadata.
- No API, contract, database, web, extension, or dependency changes.
