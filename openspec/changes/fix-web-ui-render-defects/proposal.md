# Proposal

## Why

Two independent rendering defects were found and fixed in the same working session, while reviewing `optimize-web-lcp`'s two app-config switches:

- `SwitchToggle.vue`'s knob cleared its own background and shadow while `loading`, so a fast toggle request (Labs features, the share-link switch) made the white knob flash out of view entirely instead of showing a spinner over it. Reported directly: "点击切换状态时，那个白色圆球会消失一下".
- Production CSS minification (Lightning CSS, which Vite's `cssMinify` uses when `build.minify` is truthy — distinct from `esbuild` CSS minification) silently drops the standard `backdrop-filter` declaration whenever a rule also hand-writes `-webkit-backdrop-filter` with the standard property listed first. This affected the `/b/[id]` bottom toolbar's blur (reported directly: "磨玻璃效果...在 production 环境里面是有问题的"), the same pattern in 19 other call sites across 19 components, and the E-ink override in `styles/theme.css`. One of those sites, `LoginModal.vue`, independently picked up the same hand-written pattern from an unrelated PR merged to `dev` while this fix was in flight. `preview` builds skip minification entirely, which is why the bug was invisible there.

## What Changes

- `SwitchToggle.vue`: keep the knob's surface background and shadow always visible; the loading spinner only overlays on top, instead of replacing the knob's visual state.
- Remove the redundant hand-written `-webkit-backdrop-filter` declarations across 20 components and `styles/theme.css` (25 call sites, including a literal-to-token rewrite in `BookmarksOnboardingHero.vue` that had no `-webkit-` line to begin with). The build's CSS minifier (Lightning CSS, per `build.target: es2022`) adds the vendor prefix automatically when only the standard property is present, so both declarations survive minification in the production bundle.
- Three of those sites (`SnapshotBottomToolbar.vue`, two in `SnapshotMobileNotesEntry.vue`, one in `BookmarksOnboardingHero.vue`) also switch a literal `blur(16px) saturate(150%)` value to the existing `var(--slax-blur)` token, matching the project's established pattern (`SnapshotTopBar.vue` and others already use the token) and keeping the value in one place.
- Dev-only, same root investigation: the project's custom UnoCSS dev-cache module (`apps/web/modules/dweb-dev-performance.ts`) built its pre-generated stylesheet with `preflights: false`. Without the preflight ruleset's default custom properties, every `translateX`/`translateY`/etc. utility class compiled to a `transform` with an empty `var()` fallback and was inert in `pnpm web -- dev` only — for example `SwitchToggle`'s knob never moved in dev, though it worked correctly in `preview` and `production` builds (which use this module's normal, non-cached output). Enable `preflights: true` and bump the cache's schema version so the stale on-disk cache is rebuilt.

## Capabilities

### New Capabilities

- `switch-toggle-loading-state`: the shared `SwitchToggle` control keeps its knob visible and in its correct on/off position throughout a loading request, in every build profile.
- `backdrop-filter-minification`: components that request a backdrop blur render that blur in the production build, not only in unminified builds.

### Modified Capabilities

None. No other capability's spec changes.

## Impact

- Web: `app/components/SwitchToggle.vue`, `app/components/Snapshot/SnapshotBottomToolbar.vue`, `app/components/Snapshot/SnapshotMobileNotesEntry.vue`, `app/components/BookmarkList/{AddUrlTopModal,BookmarksOnboardingHero,BookmarksSearchBar}.vue`, `app/components/Collection/CollectionModal/{CancelCollectionModal,EnableCollectionModal}.vue`, `app/components/CursorToast/CursorToast.vue`, `app/components/Dashboard/{DashboardClient,DatePicker,HistoryLineChart,HistorySection,KindStatsSection}.vue`, `app/components/GetSubscribeModal.vue`, `app/components/Layouts/SnapshotSidePanel.vue`, `app/components/Modal/{EditTag,LoginModal}.vue`, `app/components/PaymentModal/{InviteCodeModal,PaymentModal}.vue`, `app/components/SubscriptionModal/SubscriptionModal.vue`, `styles/theme.css`, `modules/dweb-dev-performance.ts`.
- No API, contract, dependency, or database change. No new build-time flag (unlike `optimize-web-lcp`'s two switches, carried on a separate change/PR history); these are unconditional fixes to existing shipped behavior.
- No visual design change: the blur radius, saturation, and knob appearance are unchanged from what the source already specified — only the broken production rendering is corrected to match the already-approved design.

## Non-goals

Auditing every `backdrop-filter`/`-webkit-backdrop-filter` pair project-wide beyond the 18 sites found by direct text search (`grep -rln -- "-webkit-backdrop-filter"`) in `apps/web/app` and `apps/web/styles`; changing the blur radius, saturation, or color of any surface; touching `SwitchToggle`'s on/off transition timing or colors; any change to `optimize-web-lcp`'s switches (tracked on that change's own history).
