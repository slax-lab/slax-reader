# Proposal

## Why

The 2026-11-22 test-environment pass found that on a slow cold start of `/b/[id]`, an owner's subscription check stays "checking" for the life of the page: Chat shows "Checking your subscription…", the panel chunk never loads, and neither waiting, going offline and back online, nor the existing retry control recovers. A second load of the same page works.

`useUserSubscribe` clears its error whenever the account context's `generation` changes, which returns the status to `pending`, but it requests a fresh check only when `accountKey` changes. During a cold start the generation is bumped for the same account (a rotated token from the daily token refresh, or an identity invalidation after a failed or superseded profile read), so the page is left `pending` with no request in flight. The pending state also hides the retry action, which the reader-scroll-restoration change only shows for `error`.

This code shipped with `fix-reader-initial-scroll` (#641) and is already on `main`.

## What changes

- When the account generation changes for a signed-in reader and no current check for that generation is in flight, the reader starts a fresh subscription check, so `pending` always has a request behind it.
- A failure of that check reports `error` with the existing retry action. A failed check invalidates the identity itself; that change does not start another check, so a failing service is not retried in a loop.
- When the identity changes while a check runs and the check ends without a decision, at most two follow-up checks run before the reader sees `error` with the retry action.

## Impact

- Spec: `web-reader-scroll-restoration`, which the unarchived change `fix-reader-initial-scroll` creates. This change adds one requirement to that capability, so it MUST be archived after `fix-reader-initial-scroll` (sequenced, per the repository OpenSpec rule for changes touching one capability).
- Web only: `apps/web/app/composables/useUserRelative.ts` and its tests. No API, contract, Extension, or Mobile change. Web carries no package version.
