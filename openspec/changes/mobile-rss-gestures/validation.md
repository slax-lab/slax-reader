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

- Local pre-push review found one Important bug: a short cancelled opening pan could leave row input locked because `show(false)` had no state change to drive the unlock effect. Fixed by restoring `locked.value = next` in the generation-fenced `show` callback, with the short-pan regression above; focused tests and typecheck re-ran successfully.

## Running environment

- Android fixture project: `slax-reader-ui-fixture-T9cKY7` (generated with `pnpm mobile -- fixture:project --scenario rss-populated --locale en --platform android`).
- The project was generated from this worktree, so it contains the changed JS sources. Reusing the previously installed fixture APK failed at startup (`ReferenceError: Property 'TextDecoder' doesn't exist`), so native acceptance requires a fresh fixture APK build.
- **Human decision (2026-10-22):** the user waived native device verification for the download-icon flicker and accepted a successful JS bundle as the delivery gate for this change ("确保能Js bundle出来的话，就去提PR"). No hands-on native acceptance was performed before opening the pull request; this is the recorded acceptance decision rather than an unrecorded gap.

## Not verified

- Native Android/iOS interaction for any of the four scenarios. The prior fixture APK was incompatible (`TextDecoder` missing), and the user explicitly waived the device pass in favor of the JS bundle gate above.
- Concurrent automatic article downloads on a device: the fixture scenarios seed static `is_downloaded` values and expose no control that starts or completes article caches, so the no-flash behavior is established by the mounted timer test. The user asked not to pursue this verification.
- Frame-rate/smoothness claims: not measured; the change preserves the existing UI-thread animations and adds no per-frame React state.

## Open decision

- Mobile `apps/mobile/package.json` version bump (current `1.0.25`, build 783) is pending. No version metadata was changed in this branch; the pull request records the decision as pending.
