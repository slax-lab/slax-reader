# Proposal

## Why

Two independent edge-case passes against the test environment on 2026-11-21 and 2026-11-22 found defects in the deferred reader startup shipped by `optimize-bookmark` (#688):

- When the local database becomes ready after the 1.5 s bounded wait, the late switch to local data never restores the saved reading position, and the next capture at the top of the page deletes it.
- A highlight written while the page still uses REST disappears for 290–605 ms at the switch, because the hand-over check compares local rows only with the marks first loaded from REST.
- On a document opened by reloading an article that was reached from the Inbox, the browser Back button does nothing: the exit guard cancels the history navigation, the router rewinds history, and that traversal cancels the document load the guard just started.
- A top-level `/x/ext-bridge` (with or without a trailing slash), which serves no purpose outside the extension frame, still runs a full local database startup and sync connection.
- `/x/ext-bridge/` (trailing slash) is served without the `frame-ancestors` policy that protects `/x/ext-bridge`.

## What changes

- A late switch to local data restores the reading position once, as an early switch does, unless the reader has already interacted; before the switch, captures do not clear or overwrite the saved position.
- Marks the reader writes or deletes on the page before the switch count as shown, so local rows replace the REST marks only once they cover those changes.
- A history traversal that leaves a deferred document is allowed to complete, then the destination loads as a new document; other navigations keep the current behavior.
- A top-level `/x/ext-bridge` or `/x/ext-bridge/` behaves as when local mode is unavailable.
- `/x/ext-bridge/` carries the same `frame-ancestors` policy as `/x/ext-bridge`.

## Impact

- Specs: `web-local-sync` and `public-page-startup` (the latter only narrows "extension bridge" to the bridge frame).
- Web only: `apps/web/app/pages/b/[id].vue`, `apps/web/app/composables/useReadingPosition.ts`, `apps/web/app/plugins/powersync.client.ts`, `apps/web/nuxt.config.ts`, and their tests.
- No API, contract, schema, Extension, or Mobile change. Web carries no package version.
- Not UI-visible beyond correcting broken behavior to match the existing specs, so no demo is offered; the change still records hands-on acceptance before its pull request because reader behavior changes.
