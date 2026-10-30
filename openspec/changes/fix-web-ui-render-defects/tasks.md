# Tasks

## 1. Fix `SwitchToggle.vue`'s loading-state knob

- [x] 1.1 In `apps/web/app/components/SwitchToggle.vue`, remove the `.knob.loading { background: transparent; box-shadow: none }` rule so the knob's surface stays visible while `loading` is true; the spinner remains an overlay child of `.knob`.
- [x] 1.2 Confirm the existing unit test `tests/unit/components/SwitchToggle.spec.ts` still passes unchanged (it asserts the `.knob.loading` class is present during loading; this fix only removes the background/shadow reset, not the class).

## 2. Fix the dev-only UnoCSS preflight gap (enables manual verification of 1.1)

- [x] 2.1 In `apps/web/modules/dweb-dev-performance.ts`, set `preflights: true` in the `buildUno` call and bump `CACHE_SCHEMA` so the stale on-disk dev cache is invalidated and rebuilt.
- [x] 2.2 Verify: delete `apps/web/.cache/unocss/`, run `pnpm web -- dev`, and confirm a `translateX`/`translateY` utility class (e.g. `SwitchToggle`'s `.on .knob`) computes a non-empty `transform` in the browser, matching `preview`/`production`.

## 3. Remove the redundant hand-written `-webkit-backdrop-filter` declarations

- [x] 3.1 Remove the hand-written `-webkit-backdrop-filter` line (keeping the standard `backdrop-filter` line) in all 24 such call sites: `SnapshotBottomToolbar.vue`, `SnapshotMobileNotesEntry.vue` (×2), `BookmarkList/{AddUrlTopModal,BookmarksSearchBar}.vue`, `Collection/CollectionModal/{CancelCollectionModal,EnableCollectionModal}.vue`, `CursorToast/CursorToast.vue`, `Dashboard/{DashboardClient (×3),DatePicker,HistoryLineChart (×2),HistorySection (×2),KindStatsSection}.vue`, `GetSubscribeModal.vue`, `Layouts/SnapshotSidePanel.vue`, `Modal/{EditTag,LoginModal}.vue`, `PaymentModal/{InviteCodeModal,PaymentModal}.vue`, `SubscriptionModal/SubscriptionModal.vue`, `styles/theme.css`. `LoginModal.vue` picked up the same pattern from a separate PR merged to `dev` after this branch was cut; rebased and fixed there too.
- [x] 3.2 In `SnapshotBottomToolbar.vue`, `SnapshotMobileNotesEntry.vue` (×2), and `BookmarksOnboardingHero.vue`, also replace the literal `blur(16px) saturate(150%)` value with the existing `var(--slax-blur)` token, matching the project's established pattern.
- [x] 3.3 Verify with the project's actual pinned `lightningcss` version that a standard-only `backdrop-filter` declaration survives minification with the vendor prefix added automatically (reproduces both the bug and the fix direction outside the full build).
- [x] 3.4 Build the app with `SLAX_ENV=production` and scan the compiled CSS under `dist/_nuxt/`: confirm every rule carrying a standard `backdrop-filter` declaration also carries `-webkit-backdrop-filter` in the output.

## 4. Validation

- [x] 4.1 `pnpm --filter @apps/slax-reader-dweb typecheck` — passes.
- [x] 4.2 `pnpm web -- test` — full suite passes with no new failures.
- [x] 4.3 `npx eslint` on every changed file — clean (two pre-existing, unrelated findings on `origin/dev` were left untouched: an import-sort error in `EditTag.vue`, unused-selector warnings in `HistoryLineChart.vue`).
- [ ] 4.4 Human hands-on acceptance (`DESIGN.md` §10.2) of the restored knob behavior and the restored backdrop blur, across the themes/widths `DESIGN.md` §6 requires for the affected surfaces, in a running `preview` or production-equivalent build (the `backdrop-filter` bug does not reproduce in an unminified dev/preview build, so acceptance needs a minified build to actually exercise the fix).
- [ ] 4.5 Record the acceptance from 4.4 in `validation.md` (who, when, what was adjusted) before opening or un-drafting the pull request.
