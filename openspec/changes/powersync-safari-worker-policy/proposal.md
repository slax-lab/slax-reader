# Proposal

## Why

The Web app currently tries SharedWorker whenever the browser exposes the API, overriding PowerSync's conservative defaults for Safari and mobile browsers. Reported iPhone sessions can spend eight seconds waiting for shared initialization, then lose live synchronization for that page after recovery falls back to REST.

## What Changes

- Select the initial worker mode using the platform checks from the installed `@powersync/web` 2.4.0 defaults: require SharedWorker support, exclude Android/iPhone/iPod/iPad user agents, and exclude browsers identified by `window.safari`.
- Start production database initialization directly in Dedicated Worker mode on excluded platforms, while retaining SharedWorker on eligible desktop browsers.
- Preserve the existing recovery safety rules, including stopping local recovery after initialization timeout or failed cleanup, and preserve development's main-thread initialization.
- Add regression coverage for platform selection and its connection to the actual initialization path.

## Capabilities

### New Capabilities

- `web-local-sync`: Platform-aware local database initialization and safe recovery for Web synchronization.

### Modified Capabilities

None.

## Impact

- Web PowerSync plugin, a small local-first worker-policy helper, and focused local-first tests.
- No dependency upgrade, schema or database-file change, storage migration, sync transport change, or Service Worker change.
- Safari/mobile sessions use the SDK's existing non-shared synchronization path, which has weaker cross-tab notification guarantees than shared mode.
- This removes the forced SharedWorker attempt on excluded platforms; it does not establish the cause of the separately reported 20-second delay or guarantee that all iPhone synchronization issues are resolved.
