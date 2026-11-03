# Adaptive source-strip verification — 2026-11-03

## Approved scope

The owner approved the same change for Collection and RSS on iOS and Android in the main checkout: intrinsic item width with a 38-point minimum, one-line names capped at 72 points, and 22-point gaps between item layout bounds. Keep existing 32-point avatars, 10/14 typography, 4-point avatar-to-name gaps, native scrolling and source selection. The previous fixed 72-point items and 12-point gaps are superseded. Other uncommitted work must be preserved. Mobile version remains 1.0.26, build 798 (previous 797), as already requested by the owner.

## Implementation and regression evidence

`SourceLine` has an opt-in reserved-weight layout. A hidden, inaccessible line measures intrinsic width at weight 500; the visible 400/500 line fills that reserved frame. Selection cannot reset the sizing measurement. The source-label path retains the requested line height at the current font scale; intrinsic text measurement determines width only. Other `SourceLine` callers retain their existing behavior. Both source strips use this layout with a 72-point name cap and a 38-point minimum item width. Existing avatar keys and feed identities remain unchanged.

The new mounted regression first failed against the original component because no stable measurement existed, then passed after implementation. Review identified that Android natural metrics could replace the requested 14-point line height. A second red test demonstrated 12 versus 14; the fix preserves 14 at default scale and 21 at 1.5 scale. Stale text/font-scale metrics and stable selected/unselected measurement identity are covered. Existing RSS editor and scroll tests only needed the new SourceLine dependency added to their strict test boundary maps.

- Final `pnpm mobile -- check`: 1,273 passed, zero failed or skipped; Kotlin compiler supplied through the existing task-local PATH. Log: `/tmp/feed-strip-check-final.log`.
- Final `pnpm exec openspec validate --all --strict`: 96 passed, zero failed. `git diff --check` passed. Log: `/tmp/feed-strip-spec-validation-final.log`.
- Final `pnpm mobile -- bundle`: both iOS and Android exports passed. Log: `/tmp/feed-strip-bundle-final.log`.
- Targeted regression red/green logs: `/tmp/feed-strip-label-red.log`, `/tmp/feed-strip-targeted.log`, `/tmp/feed-strip-lineheight-red.log`, `/tmp/feed-strip-lineheight-green.log`.
- Independent code review found the line-height issue above; the reviewer rechecked its correction and reported no remaining Important findings.

## Native iOS evidence

Device Hub ran the main-checkout application on iPhone 16, iOS 18.6, at default text size. Native interaction selected a short Collection name and a long Collection name, confirmed selection changes and middle truncation, and returned to My Inbox. Adjacent avatar/name positions remained visually stable. The RSS route rendered its existing Add RSS item correctly. This account has no RSS subscriptions, so populated RSS switching and an overflowing horizontal rail were not exercised on iOS. No subscription was created for this test. iOS collection observations are visual/accessibility evidence, not quantitative measurements of item bounds.

Evidence: `/tmp/feed-strip-ios-evidence/01-collection-own.png`, `02-collection-selected.png`, `03-rss-empty.png`, `04-collection-long.png`, `05-final-own.png` and corresponding accessibility observations. The numbered 03-rss-all historical frame was captured during picker dismissal; use 03-rss-empty for the settled RSS frame. A transient development file-lock failure was investigated against Apple's NSFileLockingError documentation. Options considered were in-app retry, cold restart to release process-owned handles, simulator restart, and an independent test install. Retry did not clear it; a cold restart restored the existing account without deleting data or changing product code.

## Native Android evidence

The independent `com.slax.reader.uifixture.bridgeverify` development client ran on the task-owned Android 15/API 35 emulator, at density 2.625. The three changed product source files were copied from the main checkout; matching hashes are recorded in `/tmp/feed-strip-fixture-overlay.json`. Native taps switched Collection sources and RSS All/source/All. Captured item bounds remain identical across each switch.

- Collection: short item 99 physical pixels (approximately 38 points after edge rounding); long items 189 pixels (72 points); adjacent gaps 58 pixels (approximately 22 points).
- RSS: All 99 pixels, Fixture Feed 143 pixels (54.48 points), Add RSS 101 pixels (38.48 points). This confirms intermediate intrinsic widths rather than only minimum/maximum widths. Adjacent gaps are 58 pixels and do not change with selection.
- Default source groups are 147 pixels / 56 points high. The label frames are 37 pixels / approximately 14 points, with pixel rounding. Labels stay one line and measured Collection long names truncate in the middle.

Accepted evidence is in `/tmp/feed-strip-android-evidence/01-collection-own`, `02-collection-active`, `07-rss-all-ready`, `08-rss-source-selected` and `09-rss-all-return`. Each contains native hierarchy, screenshot, runtime context and a recorded native input when applicable. Geometry is summarized in `geometry.json` and `collection-geometry.json`. Native gestures are distinguished from fixture state preparation.

At Android font scale 1.5, settled RSS and a native source tap were captured in `11-rss-large-settled` and `12-rss-large-selected`. Long names remain capped at 72 points and truncate; label frames expand to approximately 21 points. See `large-geometry.json`. The setting is restored to 1 after verification.

### Test environment accommodations and limits

The existing isolated fixture adapter already used synchronous fixture file writes for the installed Expo API and a canonical Android cache path. The legacy rss-populated fixture supplies API responses but does not seed the current local RSS stream. For this presentation-only run, its task-local adapter omitted the local RSS repository on nonpersistent RSS cases, exercising the application's existing API fallback. The product components/controllers and main-checkout fixture adapter were not changed for this accommodation. This validates RSS presentation and native selection through the API-backed controller path, not native RSS synchronization. Adapter hashes are recorded with the source overlay.

An unresponsive task AVD was recovered by a cold boot without wiping data. Alternatives considered were restarting the fixture process, restarting Metro, cold booting the AVD, and creating a fresh isolated AVD; the first process restart did not restore shell/inspector responsiveness. Android's emulator troubleshooting documentation was consulted before cold boot. Failed captures and transient modal/route guards remain in separate rejected diagnostics and are excluded from accepted evidence. Android configuration changes recreate the development entry; test cases must be prepared after the new entry settles.

The native cases fit their viewport, so overflowing horizontal scrolling remains covered by the existing mounted scroll/identity regressions rather than a new native overflow gesture. No new claim is made for dark mode, other locales, or the complete existing polish acceptance matrix. Owner hands-on acceptance and PR delivery tasks remain open; no commit, push or PR was requested.

## Preservation and delivery

The initial 69 dirty-file hashes are retained in `/tmp/feed-strip-adaptive-preserved.json`. The preservation audit allows only this change's component, regression-test and OpenSpec/verification files. Prior Reader/bridge fixes, generated bridge output, version metadata and unrelated uncommitted work remain intact. No dependency or native binary source change was needed for this feature.

The final preservation audit reports 61 of the 69 initially dirty files byte-for-byte unchanged; the eight changed initial files are the two affected source-strip files, the RSS test boundary and this change's OpenSpec records. The four newly dirty files are SourceLine, the additional RSS test boundary, the new label regression and this verification report. There are zero unexpected file changes. Audit: `/tmp/feed-strip-preservation-audit.json`. Native fixture product-source hashes match the final main-checkout files. Android font scale was confirmed restored to 1.0.
