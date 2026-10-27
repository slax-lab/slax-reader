# Validation

## Commands

| Command | Result |
| --- | --- |
| `pnpm mobile -- check` | Pass — architecture: 238 modules, 0 violations, 3 existing exceptions; RSS controller/fixture checks and `tsc --noEmit`; full mobile suite: 1,418 tests passed, 0 failed. |
| `pnpm mobile -- bundle` | Pass — iOS and Android Hermes bundles exported to `dist` (14 MB each), with the app assets. |
| `openspec validate mobile-rss-gestures --strict` | Pass. |
| `openspec validate --all --strict` | Pass — 73/73 items. |
| `git diff --check` | Pass — no whitespace errors. |

Focused suites also run directly:

- `node --experimental-strip-types --test tests/ui/feed-scroll-and-drawer.test.mjs tests/ui/shared-motion.test.mjs tests/ui/bookmark-status-icon.test.mjs` — 16/16 pass.

## Automatic coverage added

- `tests/ui/feed-scroll-and-drawer.test.mjs`
  - RSS source switching issues exactly one scroll command (offset 0), never restores the previous source's offset, keeps the native list/rail lifetime, and leaves anchoring disabled at the top.
  - The rail renders All first, marks it selected when no source is selected, and calls `select(null)`.
- `tests/ui/bookmark-status-icon.test.mjs`
  - A download completing before the 250 ms delay goes directly from uncached to cached.
  - A visible clock is held for the 450 ms minimum before the completion glyph.
  - A pending timer is cleared on unmount.
- `tests/ui/shared-motion.test.mjs`
  - A second gesture that supersedes the first close still publishes the close, leaves the overlay non-interactive, leaves the feed interactive, and allows a later open.
  - A short opening pan that settles closed restores the row input lock instead of leaving rows inert.

## Review round

- Local pre-push review found one Important bug: a short cancelled opening pan could leave row input locked because `show(false)` had no state change to drive the unlock effect. Fixed by restoring `locked.value = next` in the generation-fenced `show` callback, with the short-pan regression.
- The automated PR review found one Important regression: enabling the opening pan from `visible` disabled an active drag as soon as its own `show(true)` flipped visibility, which cancels the gesture. The pan now stays enabled unless the drawer is both open and visible, and the regression test asserts `config.enabled` after that visibility flip and races both close drags before JS delivery.
- Focused suites and typecheck re-ran successfully after both fixes.

## Running environment

- The automated fixture path was prepared (`slax-reader-ui-fixture-T9cKY7`) but the previously installed fixture APK was incompatible (`ReferenceError: Property 'TextDecoder' doesn't exist`), so the agent did not complete a device pass through that harness.
- **Human hands-on acceptance (2026-10-22):** the repository owner reports exercising the changed interactions by hand on a device and accepting the result ("已经摸过了"); no adjustments were requested. The owner had initially accepted the JS bundle as the gate and confirmed the hands-on pass after the pull request was opened; this entry is the acceptance record.

## Not verified

- Concurrent automatic article downloads on a device: the fixture scenarios seed static `is_downloaded` values and expose no control that starts or completes article caches, so the no-flash behavior is established by the mounted timer test. The owner asked not to pursue this verification.
- Frame-rate/smoothness claims: not measured; the change preserves the existing UI-thread animations and adds no per-frame React state.
- The owner's hands-on pass is not itemized by device/platform or by each scenario's edge cases; it records acceptance of the four changed behaviors rather than a platform matrix.

## Version decision

- Human approved a build-only increment on 2026-10-22: `version` stays `1.0.25`, `buildNumber` advances 783 → 784, `previousBuildNumber` becomes 783.
- Updated `apps/mobile/package.json`, both iOS `CFBundleVersion` values, the app target's `CURRENT_PROJECT_VERSION`, Android `versionCode`, and the `SlaxVersionCode` manifest metadata. No signing, upload, or store publication was requested.
