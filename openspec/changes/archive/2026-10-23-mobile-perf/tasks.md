# Tasks

## 1. Hidden Library work

- [x] 1.1 Subscribe the Library bookmark and collection-bookmark watches only while the Library is focused and the application is active, keeping readiness and collection clearing in separate effects; verify with the `pdf-import.test.mjs` case "Library stops bookmark watches while blurred or backgrounded and keeps the last rows visible" (fails against the previous source)

## 2. Reader header stability

- [x] 2.1 Expose toolbar visibility as a reader-owned `FeatureState<boolean>` and have `ReaderHeaderMore` read it through `useSyncExternalStore`, removing visibility from the header render callback dependencies; verify with the extended `screen-lifecycle.test.mjs` article cases (mounted header follows flips, no extra `setOptions`; fails against the previous source)

## 3. Feed scroll sampling

- [x] 3.1 Set feed `scrollEventThrottle` to 48 ms and record exact settled offsets from `onScrollEndDrag` / `onMomentumScrollEnd`; verify with the `feed-scroll-and-drawer.test.mjs` case "coarse scroll sampling still records the exact resting offset from drag and momentum end events"

## 4. Tooling and delivery metadata

- [x] 4.1 Assign a fixture resource owner for non-PDF UI fixture scenarios; verify the `library-populated` fixture Library renders rows on the iOS simulator instead of staying in loading
- [x] 4.2 Increase the mobile build number from 771 to 772 across Android, iOS app/share extension and package metadata; verify no `771` build value remains except `previousBuildNumber`

## 5. Verification

- [x] 5.1 Run `pnpm mobile -- test`, `pnpm mobile -- check`, `pnpm mobile -- bundle` and `git diff --check`; all pass (1285 tests, 0 failures, 2 skipped)
- [x] 5.2 Record the iOS simulator A/B (2,000 synthetic bookmarks, four identical reader actions): hidden bookmark watch callbacks +5 → 0, about 107 ms → 0 JS time, `navigation.setOptions` +3 → 0; record that feed scroll sampling, native header cost and physical-device/Release behavior were not measured
- [x] 5.3 Run the REVIEW.md local pre-push review (bugs, security, compliance) and resolve Important findings
