# Recover pending library edits after session expiry

**Approved on November 25, 2026.** The change requester approved the proposed scope and behavior.

## Why

A renamed bookmark appears immediately in the library. The reported same-account re-login restored the old title. The production client calls clearAuth on an upload 401 and can then disconnect and clear its local database.

## What Changes

- When authentication interrupts a local upload, tell the reader that edits await sign-in. Resume that owner's pending changes on verified same-account return.
- When the same account signs in after the interrupted upload, the new title returns, the pending change uploads, and a second session reads the new title.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-local-sync` — Recover pending library edits after session expiry.

## Impact

apps/web/app/plugins/powersync.client.ts, apps/web/app/composables/useAuth.ts and the library sync indicator.

Sequence after fix-deferred-reader-takeover for web-local-sync. Retest the cold-start 401 path covered by fix-expired-session-cold-start.

[powersync.client.ts](../../../apps/web/app/plugins/powersync.client.ts) · [Session termination contract](../../../openspec/specs/web-session-termination/spec.md)
