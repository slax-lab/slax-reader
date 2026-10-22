# Proposal

## Why

Four mobile interaction defects make the core reading surfaces feel unstable and, in one case, unusable: the RSS rail cannot return to its default combined timeline, switching RSS sources visually shifts the feed, concurrent automatic downloads make the Library status icons flicker, and the first drawer close can leave the whole app unable to receive gestures. They are observed regressions in the native app rather than missing features.

## What Changes

- Add the missing **All** source to the mobile RSS source rail, selected by default and reachable again after selecting an individual source.
- Make RSS source switching position-safe: the new source always starts at the top, the previous source's saved offset is never restored into it, and the source rail keeps its horizontal position while switching.
- Keep the Library row download indicator visually stable while several automatic downloads run, instead of rapidly swapping glyphs.
- Make the Library drawer's open/close state converge even when a gesture interrupts the first close, so the dismiss surface never keeps swallowing touches and the feed never stays input-locked.
- Cover the four behaviors with mounted host tests using the existing installed gesture/animation modules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rss-labs`: The native RSS user experience gains the All source and a requirement that source switching preserves a predictable position.
- `mobile-app-parity`: The Library list's row status presentation must stay stable during concurrent automatic caching.
- `mobile-visual-parity`: Interrupted or superseded drawer motion must always restore the correct touch owner and interaction state.

## Impact

- `apps/mobile/src/components/RssFeed.tsx`
- `apps/mobile/src/components/feed-scroll.ts` (behavior used by the RSS list)
- `apps/mobile/src/components/SourceDrawer.tsx`
- `apps/mobile/src/components/BookmarkRow.tsx` and an owned status-indicator component
- `apps/mobile/tests/ui/feed-scroll-and-drawer.test.mjs`, `shared-motion.test.mjs`, `list-performance.test.mjs`
- No API, database, native dependency, or asset changes.
