# Design

## Context

See proposal.md for motivation. Relevant current structure:

- `LibraryScreen` already derives `clockActive` from route focus plus `AppState`, and publishes list rows through `useVisibleSnapshot`, which retains the latest value per owner scope and only publishes while visible. The bookmark watches themselves were subscribed independently of `clockActive`.
- Row watches (`RowWatcher.watchRows`) re-run SQL and reconcile rows on every relevant table change and emit an initial result on subscription.
- The reader passes `headerRight` / `unstable_headerRightItems` render callbacks to `navigation.setOptions` in a layout effect. The callback closed over `toolbarIsVisible`, so each toolbar flip produced a new callback and a new `setOptions` call.
- `FeatureState` (`src/reader/state/feature-state.ts`) is the existing reader-owned external store used with `useSyncExternalStore` for AI and draft state.
- `useFeedScrollPosition` drives both the Library inbox list and the RSS list through spread `events`.

## Goals / Non-Goals

**Goals:**
- Remove hidden Library query work while the reader or another route is in front, without visible loading/empty regressions.
- Make toolbar visibility changes independent of navigation option updates.
- Reduce feed scroll callback frequency without losing exact restored offsets.

**Non-Goals:**
- Changing reader article scroll sampling, native header/footer motion, or the reader host (owned by `mobile-startup-offline-image-performance`).
- Preserving row object identity across a resubscription, list virtualization changes, or row layout changes.
- Device/Release profiling (recorded as a verification limit, not a design goal).

## Decisions

- **Gate watches on `clockActive` instead of adding a pause API to repositories.** The screen already owns focus/AppState state and `useVisibleSnapshot` already retains rows, so unsubscribing is the smallest change with a single lifecycle owner. Alternative: a pausable watch in the data layer that keeps its reconciliation cache; rejected for now because it widens the repository port for a one-query refocus cost (~20 ms at 2,000 rows on the simulator).
- **Split readiness/clearing effects from subscription effects.** `setRowsReady(false)` and collection-row clearing depend only on repositories/sort/collection owner, so refocusing does not flash the loading or "collection empty" state.
- **Header visibility via `FeatureState<boolean>` and `useSyncExternalStore`.** The header element subscribes to the store, so the render callback identity no longer depends on visibility and `setOptions` runs once per presentation. The store is synchronized in a layout effect so pointer-event and accessibility changes land in the same commit as the toolbar state. Alternative: forcing the header element always visible; rejected because it would break hit-testing and accessibility hiding.
- **`scrollEventThrottle` 48 plus `onScrollEndDrag` / `onMomentumScrollEnd`.** Feeds only persist offsets and top state, so ~20 Hz sampling is sufficient while moving; end events reuse the same clamping and pending-restore guard to record the exact settled value. Alternative: keep 16 ms; rejected because it delivers a JS callback per frame for no visible benefit.
- **Fixture owner for non-PDF scenarios.** Non-PDF fixture sessions assign `fixture-<scope>` without activating native reader resources, matching how data-gated screens check readiness; PDF scenarios keep their existing activation/revocation path.

## Risks / Trade-offs

- [Rows can be briefly stale on return] → The previous rows stay visible until the resubscribed query lands; this matches existing `useVisibleSnapshot` behavior and avoids a loading flash.
- [Resubscription creates new row objects, so visible memoized rows re-render once on return] → Bounded to the visible window; acceptable versus repeated hidden queries during reading.
- [Coarser sampling delays mid-scroll top-state detection by up to ~48 ms] → End events correct the final state; top state only gates the list's content-position anchor.
- [Simulator Debug measurements do not establish device performance] → Recorded as a verification limit in tasks and the pull request.
