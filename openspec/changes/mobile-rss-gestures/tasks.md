# Tasks

## 1. RSS sources and position

- [x] 1.1 Add the fixed All chip to `RssFeedSwitcher` with `rss_all`, `ic_rss`, selected state for `state.selected === null`, and `controller.select(null)`, then verify selecting All after a subscription renders the combined timeline.
- [x] 1.2 Move the RSS source-change reset into `useLayoutEffect`, pass `scroll.maintainVisibleContentPosition` to the list, and remove `key={state.selected}`; verify a mounted test shows a scrolled source switch issues only offset 0, the old offset is never commanded, and the rail/list instance survives.
- [x] 1.3 Update `feed-scroll-and-drawer.test.mjs` (and any mock returning the hook) for the retained list lifetime and add a source-switch regression; verify `pnpm mobile -- test` passes for the ui suite.

## 2. Library download status indicator

- [x] 2.1 Add a presentation-only status icon component that delays the downloading state by 250 ms and holds it for at least 450 ms, with timers cleaned up on status change and unmount.
- [x] 2.2 Render it from `BookmarkRow` in the existing 18 px slot; verify no row geometry or list ordering changes and the row still reads `NONE/DOWNLOADING/COMPLETED/FAILED` for assistive technology.
- [x] 2.3 Add a mounted test that drives `0 → 1 → 2` faster than the delay and asserts the downloading glyph is never presented, and a slow `0 → 1` assertion that it is presented once; verify with `pnpm mobile -- test`.

## 3. Drawer gesture convergence

- [x] 3.1 Rework `SourceDrawer` so a microtask publishes only the latest resolved open/close result, a `published` ref deduplicates callbacks, and a cancelled or superseded gesture republishes its resolved committed state from `onFinalize`.
- [x] 3.2 Remove the JS `committed` read from the hide callback, derive `locked`/`onInteractionChange` and pan enablement from `visible`, and drive content/dismiss-surface `pointerEvents` from `visible`; verify the closed drawer leaves content interactive and no overlay intercepts touches.
- [x] 3.3 Add the superseded-close regression from `design.md` to `shared-motion.test.mjs`; verify it fails on the old state machine and passes with the new one, and that the existing rapid-reversal/reduced-motion drawer tests remain green (`pnpm mobile -- test`).

## 4. Verification

- [x] 4.1 Run `pnpm mobile -- check` (architecture, fixtures, RSS controller verify, typecheck, full test) and `pnpm mobile -- bundle`; record commands and results.
- [x] 4.2 Exercise the four scenarios on Android and iOS in the fixture or development build, including switching All → source → All while scrolled, concurrent automatic downloads, and a second gesture during the first drawer close; record native evidence or an explicit gap in `validation.md`.
- [x] 4.3 Run `pnpm exec openspec validate --all --strict` and `git diff --check`; record the results.
- [ ] 4.4 Ask the human for the Mobile `apps/mobile/package.json` version decision (current `1.0.25`, build 783) before commit/hand-off and record the decision.
