# Proposal

## Why

Native sharing can report a timeout even after the server has saved the bookmark because the acknowledgement is slow to arrive. The iOS collector currently waits for the entire successful response body despite needing only the HTTP status, leaving the user unsure whether sharing succeeded.

## What Changes

- Bound the native iOS and Android add-URL attempt to five seconds of total elapsed network time, rather than only a connection or idle-read timeout.
- Accept an authenticated add-URL HTTP 200/204 response as success when its headers arrive, without waiting for an unused success body.
- After a create timeout only, keep Collecting visible and perform one read-only URL save-confirmation request, bounded to three additional seconds. Confirmed saved state uses the existing success UI; an unconfirmed result uses the existing timeout UI. Do not resubmit add_url.
- Confirm an active saved relation belonging to the same authenticated user, using the server's creation URL identity and recognizing committed Reader-link destinations before parsing finishes. Preserve the existing /exists contract for other callers; do not treat a global bookmark row, another user's relation, or a trashed relation as confirmation.
- Preserve explicit server errors, dismissal/cancellation, environment selection, standalone operation, and one sanitized terminal diagnostic record per share invocation.
- Apply the user's approved Mobile version and build increments during implementation: version 1.0.27 -> 1.0.28, buildNumber 799 -> 800, previousBuildNumber 798 -> 799. Regenerate native metadata through existing tooling so iOS main/share and Android agree.

## Capabilities

### New Capabilities

- `mobile-share-save-recovery`: Bounded native share acknowledgement, read-only saved-state recovery by URL, cancellation ownership, and compatibility of the confirmation contract. This adds a focused recovery contract to the existing general mobile sharing parity requirement.

### Modified Capabilities

None. The existing `mobile-app-parity` sharing presentation and standalone-operation requirements remain intact. Its active parity deltas and the active `mobile-diagnostic-log` change are not duplicated or rewritten by this change.

## Impact

- iOS sources under `apps/mobile/native/share/ios/`, Android sharing under `apps/mobile/modules/slax-share/`, and existing share fixture/host tests. Generated iOS share copies remain owned by `apps/mobile/plugins/with-share.cjs`.
- Bookmark HTTP/domain/repository lookup code and any additive contract needed for read-only save confirmation; generated API routes must be updated through their generator. Existing save and workflow admission behavior remains authoritative.
- Mobile manifest, generated public native version metadata, and the release documentation's current source-version record. No new package dependency or database migration is planned.
- Worktree `/Users/daguang/project/slax-reader-share-recovery`, branch `fix/share-save-timeout-recovery`, based on `origin/dev` at `999dc2e5`. The original dirty worktree is out of scope.

## Non-goals

No automatic create retries, background outbox, new workflow/retry system, request-ID registry, database schema changes, capture/parser changes, UI redesign, signing, upload, production deployment, or store publication. Saved confirmation does not promise completed article parsing or prove that this invocation originally created an already-saved URL.

## Review Boundary

The owner approved implementation and the version/build increments, then explicitly authorized commit, push, and a pull request after the final relevant unit tests pass. On 2026-11-04 the owner confirmed this changes request/recovery logic, not UI presentation, and accepted automated unit/host tests plus the existing iOS/Android bundle check instead of native builds or manual/device acceptance for this conditional network scenario. No UI layout, assets, strings, motion, or accessibility presentation is changed. Native builds and extended device/runtime exercises are excluded from this PR's acceptance gate; their earlier outcomes remain disclosed in validation.md. Merge, deployment, signing, upload, and publication are not authorized by PR creation.
