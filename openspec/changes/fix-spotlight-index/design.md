# Design

## Readiness is not preference

The controller currently receives `enabled`/`donationsEnabled` derived from `surfacesReady`, which is false during backgrounding and credential refresh. `reconcile(false, false)` then interprets that as an opt-out and revokes both surfaces. The fix keeps two independent inputs:

- **Preference**: the persisted, user-controlled discovery/donation switch.
- **Ready**: whether the app can publish now (preferences loaded, authenticated account, native owner, upgrade ready, credentials ready).

The caller derives the preference from loaded settings and passes `ready` separately. The controller uses the preference and the owner identity for revocation, and `ready` only to decide whether to set up the publication watcher.

## Revocation rules

Revoke the catalog and donations only when:

- the corresponding preference is explicitly false;
- no authenticated owner exists (sign-out);
- the owner key changes (user, API origin or native generation);
- content is deleted or the OS removal is pending (existing behavior).

When the owner and preference are unchanged but `ready` is false, keep the existing catalog, donation IDs and pending receipts. When readiness returns, reconcile again and republish from the current local snapshot.

`currentOwner()` must return the active owner identity without requiring credential readiness. Credential readiness is a publication gate, not identity. This prevents a background pause from looking like a sign-out.

## Native registration

`registerIndexed` and `AppIntentDonationRegistry.register` are synchronous and must run in `OnCreate` before the asynchronous shortcut-refresh task. This removes the window where JavaScript publishes or donates before the indexer/donation intent is registered.

## Open intent

`OpenBookmarkIntent` already has the required `target` parameter and dispatch implementation. Conforming to `OpenIntent` lets Spotlight invoke it with the searched entity and keeps the existing `openBookmark` route as the single navigation path.

## Entry router lifetime

`SystemEntryRouter.dispose()` clears its in-memory pending map. The runtime effect that currently activates and disposes the router also depends on credential and native readiness, so a credential transition during cold start disposes the router after a pending `openBookmark` was received but before it is ready, and the invocation is lost. The router lifetime must follow the account/API-origin lifetime, not readiness. Readiness changes call `contextChanged()` and drain the existing pending map; account or origin replacement disposes the router and clears old pending work before the replacement owner is used.
