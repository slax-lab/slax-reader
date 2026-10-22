# Design

## Context

See `proposal.md` for motivation.

- `LibraryScreen` keeps one `FeedScrollPosition` per mode (`inbox`, `rss`). The RSS list is a `FlatList` currently keyed by `state.selected`, so every source tap remounts the native list and everything in `ListHeaderComponent`, including the horizontally scrolled source rail.
- `useFeedScrollPosition` restores a retained offset from layout/content-size callbacks. Its reset currently runs in a passive effect in `RssFeed`, after the same commit has already armed restoration with the previous source's offset.
- `RssController` already models `selected: string | null`, with `null` meaning all subscriptions, and `watchEntries(null)` already returns the combined local timeline. Only the rail is missing that choice.
- Automatic caching writes `is_downloaded` as `0 → 1 → 2` (or `3` on failure); a short text download can complete within a few frames, and `BookmarkRow` swaps the glyph with a raw `Image` source change.
- `SourceDrawer` publishes the resolved open state from a `runOnJS` callback gated by a UI-thread `generation`. Another pan activating before that callback runs bumps the generation, so the parent can stay `open: true` while the drawer is visually closed; the full-screen dismiss surface then keeps `pointerEvents: auto` and the content stays `pointerEvents: none`.

## Goals / Non-Goals

**Goals:**

- All four defects are fixed with local changes to presentation, the existing drawer state machine and tests.
- Existing saved-position restoration when leaving and re-entering RSS mode, Inbox/RSS mode switching, and drawer drag/reversal behavior remain intact.
- All behavior stays on the installed Reanimated/Gesture Handler paths.

**Non-Goals:**

- No new navigation route, API, database column, or native module.
- No redesign of the RSS rail or Library row visuals.
- No change to automatic-cache scheduling, concurrency, or persistence semantics.

## Decisions

### RSS source switching

- Run the source-change reset in `useLayoutEffect` instead of `useEffect`, before native layout callbacks for the new render can use the old offset.
- Pass `scroll.maintainVisibleContentPosition` instead of a hardcoded `{minIndexForVisible: 0}` so anchoring stays disabled while the list is at the top, matching Inbox.
- Remove `key={state.selected}` from the RSS `FlatList`. The reset to offset 0 already isolates sources, and keeping one native list keeps the source rail mounted and horizontally positioned. Rows are still isolated by `entry.id`.

Alternative considered: keep the keyed remount and hoist the rail out of the list header. That preserves remount isolation but changes the rail from scrolling with the feed and still pays avatar re-resolution on every switch.

### All RSS source

- Render a fixed first chip in `RssFeedSwitcher` that calls `controller.select(null)`, shows the existing `rss_all` label, and takes the selected ring when `state.selected === null`.
- Reuse the existing `ic_rss` asset and the same 48/41 px geometry as subscription chips; the controller and local watcher already support a null selection.

### Download status indicator

- Introduce a small presentation-only status icon component that owns the displayed state for one row.
- Delay the downloading state by 250 ms; a download that completes first goes directly to cached.
- Once shown, hold the downloading state for at least 450 ms before switching to the terminal state, so a download that completes just after the threshold cannot produce a one-frame flash.
- Keep the icon in the existing fixed 18 px slot; no layout, list order, or row geometry changes.

Alternative considered: crossfade every glyph swap. It smooths the visual but still presents a flash for sub-frame downloads and adds animation state to every row; the dwell policy removes the transient state instead.

### Drawer convergence

- Publish the latest resolved open/close result in a microtask, so a burst of rapid reversals reports only the final intent once and deduplicates against the last published state.
- When a gesture is cancelled or superseded after activating, republish its resolved committed state from `onFinalize`; this covers a close whose original commit was overtaken by the next gesture.
- Keep `generation` only as the fence for stale animation completion callbacks that hide the drawer.
- Treat the last published result as the settled external state: the `open` effect ignores callbacks this drawer itself initiated, so a late intermediate result cannot fight the animation already in flight.
- Remove the JS-side read of `committed` from the hide callback: animation completion only sets visibility, so a stale shared-value read can no longer keep the drawer visible.
- Derive `locked`, `onInteractionChange`, and both pan enablement flags from `visible`, instead of letting only the close animation callback unlock rows.
- Drive content and dismiss-surface `pointerEvents` from `visible`, not from the possibly stale `open` prop.
- Keep the existing timing animations, scrim, Back handler, and pan thresholds.

Alternative considered: reset the state machine after a timeout. It hides the race instead of removing it and adds a second source of truth.

## Risks / Trade-offs

- [Removing the FlatList key changes native anchor lifetime across sources] → The hook's reset (`pending`/`requested = 0`) fences late callbacks, and existing mounted tests already cover stale source callbacks; add a regression that the old offset is never commanded on switch.
- [An All selection replaces the filtered source rows with the combined timeline] → Both lists are already sorted by the same timeline comparator; the reset positions the list at the top before the watcher emits.
- [Per-row dwell timers] → Only rows in the transient downloading state hold a timer; each effect clears its timer on status change or unmount.
- [Drawer state-machine change can regress rapid reversals] → Keep all existing timing and reversal tests and add the superseded-close regression; publish dedupe preserves `true → false → true` sequences.

## Migration Plan

No data migration. Ship with the mobile app; rollback is a normal revert of the change.

## Open Questions

None.
