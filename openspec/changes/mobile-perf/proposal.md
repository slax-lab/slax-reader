# Proposal

## Why

While a reader is open, the Library behind it keeps its full bookmark query subscribed, so every background write (reading progress, automatic cache state) re-runs the query and remaps every row. Each scroll-driven toolbar flip also reconfigures the native navigation header as the toolbar animation starts, and the Library/RSS feeds receive a JS scroll callback every frame even though they only remember offsets. On an iOS simulator with 2,000 bookmarks, four reader actions cost five hidden Library queries (about 107 ms of JS time, 10,000 remapped rows) and three header reconfigurations. This work competes with reader scrolling and toolbar motion.

## What Changes

- The Library suspends its bookmark and collection-bookmark subscriptions while it is covered by another route or the application is not active, keeps the last published rows visible, and resubscribes once when it becomes visible again.
- The reader header's More action follows toolbar visibility (hit testing and accessibility hiding) without reconfiguring the native navigation header on each toolbar change.
- Library and RSS feeds sample scroll positions below display rate and record the exact settled offset when a drag or fling ends, so restored positions stay exact.
- The UI fixture runtime assigns a resource owner for non-PDF scenarios so data-gated screens such as the Library render in simulator fixtures (tooling only).
- The mobile build number increases from 771 to 772 for this delivery; the version name stays 1.0.25.

## Capabilities

### New Capabilities

- `mobile-library-reader-performance`: Hidden Library work suspension, stable reader header configuration across toolbar changes, and bounded feed scroll sampling with exact settled offsets.

### Modified Capabilities

None. The unarchived `mobile-startup-offline-image-performance` change owns `mobile-performance-lifecycle`; this change does not add a delta for that capability and does not alter its requirements.

## Impact

- `apps/mobile/src/screens/LibraryScreen.tsx`, `apps/mobile/src/components/feed-scroll.ts` (Library and RSS feeds)
- `apps/mobile/src/reader/state/useReaderInteractions.ts`, `apps/mobile/src/reader/components/ReaderHeader.tsx`, `apps/mobile/src/screens/ReaderScreen.tsx`
- `apps/mobile/fixtures/runtime.ts` (UI fixture tooling)
- Native/package build metadata under `apps/mobile/android`, `apps/mobile/ios` and `apps/mobile/package.json`
- No API, contract, schema, dependency, or data-format changes.
